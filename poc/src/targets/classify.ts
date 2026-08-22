import * as ts from "typescript-js";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { recoverVibeSyntax, type RecoveredSource } from "../language/recover.ts";

export type Portability = "portable" | "typescript-required" | "forbidden" | "undecided";

export interface PortabilityDiagnostic {
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
}

export interface FunctionCompatibility {
  name: string;
  requirements: string[];
  requirementPaths: Record<string, string[]>;
  nativePinned: boolean;
}

export interface CompatibilityAnalysis {
  functions: Record<string, FunctionCompatibility>;
  diagnostics: PortabilityDiagnostic[];
}

interface Facts {
  name: string;
  key: string;
  node: ts.FunctionDeclaration;
  nativePinned: boolean;
  direct: Map<string, string[]>;
  calls: Array<{ callee: Facts; node: ts.Node }>;
  symbol?: ts.Symbol;
}

interface RuntimeImports {
  sideEffects: Set<string>;
}

/** Nominal capability row names keyed by the checker symbol of their class. */
interface CapabilityNaming {
  bySymbol: ReadonlyMap<ts.Symbol, string>;
}

const COMPILER_PROJECT_ROOT = resolve("/vibelang-compat-project");
const COMPILER_PRELUDE_NAME = resolve(COMPILER_PROJECT_ROOT, "__vibelang_target_prelude__.d.ts");

/**
 * Checker-only declarations for the compiler-owned modules, mirroring the
 * frontend prelude in `src/language/semantic.ts` and the backend's
 * `CONTEXT_DECLARATIONS` in `portable-backend.ts`. Without them `Context` never
 * resolves here, so every `Capability.context()` read was silently reported as
 * requiring nothing at all.
 *
 * Nothing in this text has a runtime value, and `checkedProject` refuses to
 * resolve any compiler-owned specifier to a file, so `vibelang/context` can
 * only ever bind to this declaration and never to installed code.
 */
const COMPILER_PRELUDE = String.raw`
declare module "vibelang/context" {
  export abstract class Context {
    static context<C extends abstract new (...args: never[]) => Context>(this: C): InstanceType<C>
  }
}

declare module "vibelang/provider" {
  import type { Context } from "vibelang/context"
  export interface Layer<P> {
    readonly __vibeLayer: { readonly provides: P }
  }
  export const Layer: {
    succeed<C extends abstract new (...args: never[]) => Context>(capability: C, implementation: InstanceType<C>): Layer<C>
    merge<const L extends readonly Layer<unknown>[]>(...layers: L): Layer<L[number] extends Layer<infer P> ? P : never>
    provide<L extends Layer<unknown>, A>(layer: L, body: () => A): A
  }
}
`;

const undecidedGlobals = new Set(["Proxy", "WeakRef", "FinalizationRegistry"]);
const hostGlobals = new Set([
  "process",
  "window",
  "document",
  "console",
  "fetch",
  "setTimeout",
  "setInterval",
  "globalThis",
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Authored coordinates for a module whose checked Program was built over the
 * frontend's recovered text.
 *
 * Every analyzed source is authored VibeLang, which diverges from the
 * TypeScript grammar in general expression positions: `defer`, `break :label
 * value`, loop `else`, `if (const x = f(); cond)`, and value-position
 * `if`/`switch`. Stock TypeScript cannot parse those, so this analyzer would
 * see a shredded AST and silently under-report requirements. It runs the same
 * pre-parse recovery the frontend runs (`recoverVibeSyntax`) and checks the
 * derived text instead.
 *
 * Recovery is NOT length-preserving — it hoists constructs to compiler
 * temporaries declared before their containing statement — so a derived offset
 * is not an authored offset. Every portability diagnostic is source-located,
 * so `at()` maps its node back through the recovery's exact piecewise map and
 * takes the line and column from the AUTHORED text. A module with no divergent
 * syntax recovers to itself, and then this file behaves exactly as before.
 */
interface AuthoredPositions {
  readonly recovery: RecoveredSource;
  readonly lineStarts: readonly number[];
}

const authoredPositions = new WeakMap<ts.SourceFile, AuthoredPositions>();

function computeLineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) index++;
      starts.push(index + 1);
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function locateOffset(
  starts: readonly number[],
  offset: number,
): { readonly line: number; readonly column: number } {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
}

/**
 * A checker-side experiment for the three-way portability table and native-pin
 * dependency diagnostics. `@native` is deliberately POC-only because spelling
 * is still open in the spec.
 */
export function analyzeCompatibility(source: string): CompatibilityAnalysis {
  const { files, checker, projectFiles } = checkedProject({ "compat.vibe.ts": source });
  return analyzeChecked(files, checker, projectFiles, false);
}

/** Checker-backed multi-module analysis used by native-pin graph validation. */
export function analyzeCompatibilityProject(
  sources: Readonly<Record<string, string>>,
): CompatibilityAnalysis {
  const checked = checkedProject(sources);
  return analyzeChecked(checked.files, checked.checker, checked.projectFiles, true);
}

function analyzeChecked(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
  qualifyNames: boolean,
): CompatibilityAnalysis {
  const diagnostics: PortabilityDiagnostic[] = [];
  const facts = new Map<string, Facts>();
  const factsBySymbol = new Map<ts.Symbol, Facts>();
  const capabilityNaming = buildCapabilityNaming(files, checker);
  for (const file of files) {
    for (const statement of file.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
      const symbol = checker.getSymbolAtLocation(statement.name);
      const fileName = portableFileName(file.fileName);
      const key = qualifyNames ? `${fileName}#${statement.name.text}` : statement.name.text;
      const fact: Facts = {
        name: key,
        key,
        node: statement,
        nativePinned: ts.getJSDocTags(statement).some((tag) => tag.tagName.text === "native"),
        direct: new Map(),
        calls: [],
        symbol,
      };
      facts.set(key, fact);
      if (symbol) factsBySymbol.set(symbol, fact);
    }
  }

  for (const fact of facts.values()) {
    const file = fact.node.getSourceFile();
    const runtimeImports = collectRuntimeImports(file, checker, projectFiles);
    for (const requirement of runtimeImports.sideEffects) addRequirement(fact, requirement, fact.name);
    const isUnboundGlobal = (node: ts.Identifier): boolean => isAmbientReference(node, checker, file);
    const markAnyInType = (node: ts.Node | undefined): void => {
      if (!node) return;
      if (node.kind === ts.SyntaxKind.AnyKeyword) addRequirement(fact, "TypeScript", fact.name);
      ts.forEachChild(node, markAnyInType);
    };
    for (const parameter of fact.node.parameters) markAnyInType(parameter.type);
    markAnyInType(fact.node.type);
    const visit = (node: ts.Node): void => {
      // A nested callable carries its own requirements; merely creating it does
      // not execute its body. The production compiler records that callable's
      // row separately instead of contaminating the enclosing function.
      if (node !== fact.node.body && ts.isFunctionLike(node)) return;
      if (node.kind === ts.SyntaxKind.AnyKeyword) addRequirement(fact, "TypeScript", fact.name);
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        diagnostics.push(at(file, node, "VIBE3004", "type assertion portability is undecided; safe/reifiable/TypeScript-required classification needs checker proof", "warning"));
      }
      if (ts.isWithStatement(node)) {
        diagnostics.push(at(file, node, "VIBE3003", "with statements are forbidden in authored .vibe code", "error"));
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) addRequirement(fact, "TypeScript", fact.name);
        const capability = contextRequirement(node, checker, capabilityNaming);
        if (capability) addRequirement(fact, capability, fact.name);
        if (ts.isIdentifier(node.expression)) {
          if (
            (node.expression.text === "eval" || node.expression.text === "Function") &&
            isUnboundGlobal(node.expression)
          ) {
            addRequirement(fact, "TypeScript", fact.name);
          }
          const directSymbol = checker.getSymbolAtLocation(node.expression);
          const calledSymbol = directSymbol && (directSymbol.flags & ts.SymbolFlags.Alias)
            ? checker.getAliasedSymbol(directSymbol)
            : directSymbol;
          const called = calledSymbol && factsBySymbol.get(calledSymbol);
          if (called) {
            fact.calls.push({ callee: called, node });
          }
        }
      }
      for (const ambientRequirement of requirementsForAmbientAuthority(node, checker, file)) {
        addRequirement(fact, ambientRequirement, fact.name);
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Function" &&
        isUnboundGlobal(node.expression)
      ) addRequirement(fact, "TypeScript", fact.name);
      if (ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
        const imported = requirementForImportedReference(node, checker, projectFiles);
        if (imported) addRequirement(fact, imported, fact.name);
        if (hostGlobals.has(node.text) && isUnboundGlobal(node)) {
          addRequirement(fact, `Host<${JSON.stringify(node.text)}>`, fact.name);
        }
        if (undecidedGlobals.has(node.text) && isUnboundGlobal(node)) {
          diagnostics.push(at(file, node, "VIBE3002", `${node.text} portability is not classified yet`, "warning"));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fact.node.body!);
  }

  // Set propagation with one retained dependency path per requirement.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of facts.values()) {
      for (const call of fact.calls) {
        const callee = call.callee;
        for (const [requirement, path] of callee.direct) {
          if (!fact.direct.has(requirement)) {
            fact.direct.set(requirement, [fact.name, ...path]);
            changed = true;
          }
        }
      }
    }
  }

  const functions: Record<string, FunctionCompatibility> = {};
  for (const fact of facts.values()) {
    const file = fact.node.getSourceFile();
    const requirementPaths = Object.fromEntries([...fact.direct].sort(([left], [right]) => compareText(left, right)));
    functions[fact.key] = {
      name: fact.name,
      requirements: Object.keys(requirementPaths),
      requirementPaths,
      nativePinned: fact.nativePinned,
    };
    if (fact.nativePinned) {
      // Only requirements that pin the code to a JavaScript host reject a
      // native pin. A nominal Context requirement (and the ambient `Clock` and
      // `Random` classifications) names a service the native target can
      // satisfy with its own layer, so it is reported in the row above with
      // its dependency path and never rejected here.
      for (const [requirement, path] of Object.entries(requirementPaths)) {
        if (!blocksNativePin(requirement)) continue;
        diagnostics.push(at(
          file,
          fact.node,
          "VIBE3001",
          `native pin failed: ${requirement} is required through ${path.join(" -> ")}`,
          "error",
        ));
      }
    }
  }
  return { functions, diagnostics };
}

/**
 * A native pin is a checked assertion over the complete transitive graph. The
 * specification makes the built-in `TypeScript` requirement the one a pin MUST
 * reject; `Module<...>` and `Host<...>` are the POC's concrete spellings of the
 * same JavaScript-host dependence.
 */
function blocksNativePin(requirement: string): boolean {
  return requirement === "TypeScript" || requirement.startsWith("Module<") ||
    requirement.startsWith("Host<");
}

function collectRuntimeImports(
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): RuntimeImports {
  const sideEffects = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const moduleName = statement.moduleSpecifier.text;
    if (isProjectModule(statement.moduleSpecifier, checker, projectFiles)) continue;
    const requirement = requirementForModule(moduleName);
    if (!requirement) continue;
    if (!clause) {
      sideEffects.add(requirement);
      continue;
    }
    // Bound imports are classified through checker symbols at each value use.
  }
  return { sideEffects };
}

function requirementForImportedReference(
  node: ts.Identifier,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): string | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(symbol);
    if ((target.declarations ?? []).some((declaration) => projectFiles.has(resolve(declaration.getSourceFile().fileName)))) {
      return undefined;
    }
  }
  for (const declaration of symbol.declarations ?? []) {
    let current: ts.Node | undefined = declaration;
    while (current && !ts.isImportDeclaration(current)) current = current.parent;
    if (!current || !ts.isStringLiteral(current.moduleSpecifier)) continue;
    if (isProjectModulePath(current.moduleSpecifier.text, current.getSourceFile(), projectFiles)) return undefined;
    const clause = current.importClause;
    if (clause?.isTypeOnly) return undefined;
    if (ts.isImportSpecifier(declaration) && declaration.isTypeOnly) return undefined;
    return requirementForModule(current.moduleSpecifier.text);
  }
  return undefined;
}

function isAmbientReference(
  node: ts.Identifier,
  checker: ts.TypeChecker,
  _currentFile: ts.SourceFile,
): boolean {
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  if (!symbol) return true;
  if (symbol.flags & ts.SymbolFlags.Alias) return false;
  const declarations = symbol.declarations ?? [];
  return declarations.length === 0 || declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile);
}

function requirementsForAmbientAuthority(
  node: ts.Node,
  checker: ts.TypeChecker,
  currentFile: ts.SourceFile,
): readonly string[] {
  if (!ts.isIdentifier(node) || !isValueReferenceIdentifier(node) ||
    !["Date", "Math", "performance", "crypto"].includes(node.text) ||
    !isAmbientReference(node, checker, currentFile)) return [];

  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node) {
    const member = ts.isPropertyAccessExpression(parent)
      ? parent.name.text
      : parent.argumentExpression && ts.isStringLiteralLike(parent.argumentExpression)
        ? parent.argumentExpression.text
        : undefined;
    return ambientRequirementsForMembers(node.text, member === undefined ? undefined : [member]);
  }
  if (node.text === "Date" && (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.expression === node) {
    if (ts.isNewExpression(parent) && (parent.arguments?.length ?? 0) > 0) return [];
    return ["Clock"];
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name)) {
    return ambientRequirementsForMembers(node.text, bindingMemberNames(parent.name));
  }
  return ambientRequirementsForMembers(node.text, undefined);
}

/** Undefined means the whole root or a dynamically selected member escaped. */
function ambientRequirementsForMembers(root: string, members: readonly string[] | undefined): readonly string[] {
  if (members === undefined) {
    if (root === "Date" || root === "performance") return ["Clock"];
    if (root === "Math") return ["Random"];
    return root === "crypto" ? ['Host<"crypto">'] : [];
  }
  const requirements = new Set<string>();
  for (const member of members) {
    if (root === "Date" && member === "now") requirements.add("Clock");
    else if (root === "Date" && !["parse", "UTC"].includes(member)) requirements.add("Clock");
    else if (root === "Math" && member === "random") requirements.add("Random");
    else if (root === "performance") requirements.add("Clock");
    else if (root === "crypto" && ["randomUUID", "getRandomValues"].includes(member)) requirements.add("Random");
    else if (root === "crypto") requirements.add('Host<"crypto">');
  }
  return [...requirements].sort();
}

function bindingMemberNames(pattern: ts.ObjectBindingPattern): readonly string[] | undefined {
  const names: string[] = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) return undefined;
    const name = element.propertyName ?? element.name;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
      names.push(name.text);
      continue;
    }
    if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
      names.push(name.expression.text);
      continue;
    }
    return undefined;
  }
  return names;
}

function checkedProject(sources: Readonly<Record<string, string>>): {
  files: readonly ts.SourceFile[];
  checker: ts.TypeChecker;
  projectFiles: ReadonlySet<string>;
} {
  const root = COMPILER_PROJECT_ROOT;
  const entries = Object.entries(sources);
  if (entries.length === 0) throw new TypeError("compatibility project requires at least one source file");
  const staged = entries.map(([name, source]) => {
    const publicName = resolve(root, isAbsolute(name) ? `.${name}` : name);
    // Every analyzed module is authored VibeLang, whatever spelling the caller
    // gave its name: `analyzeCompatibility` stages one source as
    // `compat.vibe.ts` and the CLI stages the project's `.vibe` files. Recovery
    // therefore runs for all of them, and is the identity for a module that
    // contains no divergent syntax.
    const recovery = recoverVibeSyntax(source);
    return {
      publicName,
      internalName: publicName.endsWith(".vibe") ? `${publicName}.ts` : publicName,
      source: recovery.parseSource,
      recovery,
    };
  });
  const normalized = new Map(staged.map((entry) => [entry.internalName, entry.source]));
  if (normalized.size !== staged.length) throw new TypeError("compatibility project source paths collide");
  if (normalized.has(COMPILER_PRELUDE_NAME)) {
    throw new TypeError("compatibility project source cannot claim the compiler-owned prelude path");
  }
  const stagedByPublicName = new Map(staged.map((entry) => [entry.publicName, entry]));
  const stagedByInternalName = new Map(staged.map((entry) => [entry.internalName, entry]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    types: [],
    skipLibCheck: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalDirectoryExists = host.directoryExists?.bind(host);
  const originalRealpath = host.realpath?.bind(host);
  const virtualDirectories = new Set<string>();
  for (const fileName of normalized.keys()) {
    let directory = resolve(fileName, "..");
    while (!virtualDirectories.has(directory)) {
      virtualDirectories.add(directory);
      const parent = resolve(directory, "..");
      if (parent === directory) break;
      directory = parent;
    }
  }
  // The prelude is checked with the project but is never an analyzed module:
  // it holds no functions, is not a project file, and cannot be imported from.
  const served = new Map(normalized);
  served.set(COMPILER_PRELUDE_NAME, COMPILER_PRELUDE);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = served.get(resolve(name));
    return source === undefined
      ? originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(resolve(name), source, languageVersion, true, ts.ScriptKind.TS);
  };
  host.fileExists = (name) => served.has(resolve(name)) || originalFileExists(name);
  host.readFile = (name) => served.get(resolve(name)) ?? originalReadFile(name);
  host.directoryExists = (name) => virtualDirectories.has(resolve(name)) || Boolean(originalDirectoryExists?.(name));
  host.realpath = (name) => served.has(resolve(name)) ? resolve(name) : (originalRealpath?.(name) ?? resolve(name));
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    // A compiler-owned specifier never reaches the filesystem: it binds to the
    // ambient declaration in the prelude or to nothing, never to installed code
    // that happens to occupy the same specifier.
    if (isCompilerOwnedSpecifier(moduleName)) return undefined;
    const containing = stagedByInternalName.get(resolve(containingFile));
    if (containing && moduleName.startsWith(".")) {
      const exact = resolve(containing.publicName, "..", moduleName);
      const candidates = [exact];
      if (!/\.[^/]+$/.test(exact)) candidates.push(`${exact}.vibe`, resolve(exact, "index.vibe"));
      if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.vibe`);
      const target = candidates.map((candidate) => stagedByPublicName.get(candidate)).find(Boolean);
      if (target) {
        return {
          resolvedFileName: target.internalName,
          extension: ts.Extension.Ts,
          isExternalLibraryImport: false,
        };
      }
    }
    return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
  });
  const analyzedNames = [...normalized.keys()];
  const program = ts.createProgram([...analyzedNames, COMPILER_PRELUDE_NAME], options, host);
  const files = analyzedNames.map((fileName) => program.getSourceFile(fileName)).filter((file): file is ts.SourceFile => Boolean(file));
  if (files.length !== analyzedNames.length) throw new Error("compatibility analyzer could not create all checked source files");
  if (!program.getSourceFile(COMPILER_PRELUDE_NAME)) {
    throw new Error("compatibility analyzer could not load the compiler-owned prelude");
  }
  for (const entry of staged) {
    if (!entry.recovery.changed) continue;
    const file = program.getSourceFile(entry.internalName);
    if (!file) continue;
    authoredPositions.set(file, {
      recovery: entry.recovery,
      lineStarts: computeLineStarts(entry.recovery.authoredSource),
    });
  }
  return { files, checker: program.getTypeChecker(), projectFiles: new Set(analyzedNames) };
}

function isProjectModule(
  specifier: ts.StringLiteral,
  checker: ts.TypeChecker,
  projectFiles: ReadonlySet<string>,
): boolean {
  const symbol = checker.getSymbolAtLocation(specifier);
  return isProjectModulePath(specifier.text, specifier.getSourceFile(), projectFiles) ||
    (symbol?.declarations ?? []).some((declaration) =>
      projectFiles.has(resolve(declaration.getSourceFile().fileName)));
}

function isProjectModulePath(
  moduleName: string,
  containingFile: ts.SourceFile,
  projectFiles: ReadonlySet<string>,
): boolean {
  if (!moduleName.startsWith(".")) return false;
  const direct = resolve(containingFile.fileName, "..", moduleName);
  const candidates = [
    direct,
    direct.replace(/\.js$/, ".ts"),
    direct.replace(/\.mjs$/, ".mts"),
    direct.replace(/\.cjs$/, ".cts"),
    `${direct}.ts`,
    resolve(direct, "index.ts"),
  ];
  return candidates.some((candidate) => projectFiles.has(resolve(candidate)));
}

function portableFileName(fileName: string): string {
  const root = resolve("/vibelang-compat-project");
  const path = relative(root, fileName).replace(/\.vibe\.ts$/, ".vibe");
  return path.split(sep).join("/");
}

function requirementForModule(moduleName: string): string | undefined {
  if (moduleName.startsWith("node:")) return `Module<${JSON.stringify(moduleName)}>`;
  if (isCompilerOwnedSpecifier(moduleName)) return undefined;
  return "TypeScript";
}

/**
 * The compiler-owned module namespace, spelled exactly as
 * `isCompilerIntrinsicSpecifier` in `src/language/semantic.ts` spells it. The
 * bare, slash, and colon forms are the whole set; prefix matching was
 * deliberately removed so a package merely beginning with those letters (or a
 * scoped `@vibelang/...` lookalike) stays foreign code.
 */
function isCompilerOwnedSpecifier(specifier: string): boolean {
  return specifier === "vibelang" || specifier.startsWith("vibelang/") ||
    specifier.startsWith("vibelang:");
}

function unalias(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (!symbol) return undefined;
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * `Capability.context()` on a nominal Context subclass, resolved the way
 * `contextRequirement` in `src/language/semantic.ts` resolves it: through the
 * receiver's checker symbol rather than its spelling, so a renamed import, a
 * namespace read, and a cross-module class all name the same row.
 */
function contextRequirement(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  naming: CapabilityNaming,
): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== "context" || call.arguments.length !== 0) {
    return undefined;
  }
  const receiver = call.expression.expression;
  const type = checker.getTypeAtLocation(receiver);
  const symbol = type.getSymbol() ??
    (ts.isIdentifier(receiver) ? unalias(checker.getSymbolAtLocation(receiver), checker) : undefined);
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  if (!declaration?.name || !extendsCompilerContext(declaration, checker)) return undefined;
  return capabilityRowName(declaration, checker, naming);
}

/**
 * Authority comes from CHECKER SYMBOL IDENTITY: the base must be the `Context`
 * declared in this analyzer's own prelude file. A local class named `Context`,
 * or a `Context` exported by any other package, resolves to a different symbol
 * and confers nothing. This is the stricter of the two reference rules — the
 * frontend also accepts a `vibelang/context` module specifier by name, while
 * the portable backend requires declaration-file identity as it does here.
 */
function extendsCompilerContext(
  declaration: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  seen = new Set<ts.ClassDeclaration>(),
): boolean {
  if (seen.has(declaration)) return false;
  seen.add(declaration);
  const heritage = declaration.heritageClauses
    ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
  for (const typeNode of heritage?.types ?? []) {
    const symbol = unalias(checker.getSymbolAtLocation(typeNode.expression), checker);
    if (!symbol) continue;
    if (symbol.getName() === "Context" && isCompilerPreludeSymbol(symbol)) return true;
    const base = symbol.declarations?.find(ts.isClassDeclaration);
    if (base && extendsCompilerContext(base, checker, seen)) return true;
  }
  return false;
}

function isCompilerPreludeSymbol(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) =>
    resolve(declaration.getSourceFile().fileName) === COMPILER_PRELUDE_NAME);
}

/**
 * Module-qualified capability identity, matching `moduleRowQualifier` and the
 * collision rule in `src/language/semantic.ts`: an unqualified class name is
 * the row name while it is unique across the analyzed modules, and every
 * colliding declaration becomes `Name@module/path` instead.
 */
function buildCapabilityNaming(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): CapabilityNaming {
  const declarationsByName = new Map<string, Array<{ symbol: ts.Symbol; module: string }>>();
  for (const file of files) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name && node.heritageClauses?.length &&
        extendsCompilerContext(node, checker)) {
        const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
        if (symbol) {
          const values = declarationsByName.get(node.name.text) ?? [];
          values.push({ symbol, module: moduleRowQualifier(portableFileName(file.fileName)) });
          declarationsByName.set(node.name.text, values);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const bySymbol = new Map<ts.Symbol, string>();
  for (const [name, values] of declarationsByName) {
    if (new Set(values.map((value) => value.symbol)).size < 2) continue;
    for (const value of values) bySymbol.set(value.symbol, `${name}@${value.module}`);
  }
  return { bySymbol };
}

function capabilityRowName(
  declaration: ts.ClassDeclaration,
  checker: ts.TypeChecker,
  naming: CapabilityNaming,
): string {
  const name = declaration.name!.text;
  const symbol = unalias(checker.getSymbolAtLocation(declaration.name!), checker);
  return (symbol && naming.bySymbol.get(symbol)) ?? name;
}

function moduleRowQualifier(displayName: string): string {
  return displayName.replace(/\.vibe$/, "").replace(/[^A-Za-z0-9._/-]/g, "_");
}

function isValueReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (
    (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  ) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if (
    ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
      ts.isEnumDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent)) && parent.name === node) ||
    ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)
  ) return false;
  if (
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
  ) return false;
  for (let current: ts.Node | undefined = parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return false;
    if (ts.isExpression(current) || ts.isStatement(current)) break;
  }
  return true;
}

function addRequirement(fact: Facts, requirement: string, path: string): void {
  if (!fact.direct.has(requirement)) fact.direct.set(requirement, [path]);
}

function at(
  file: ts.SourceFile,
  node: ts.Node,
  code: string,
  message: string,
  severity: "error" | "warning",
): PortabilityDiagnostic {
  return {
    code,
    message,
    severity,
    file: portableFileName(file.fileName),
    ...authoredPoint(file, node.getStart(file)),
  };
}

/** Derived offset in `file` to a line and column in its authored source. */
function authoredPoint(
  file: ts.SourceFile,
  offset: number,
): { readonly line: number; readonly column: number } {
  const authored = authoredPositions.get(file);
  if (!authored) {
    const position = file.getLineAndCharacterOfPosition(offset);
    return { line: position.line + 1, column: position.character + 1 };
  }
  const { recovery, lineStarts } = authored;
  const mapped = recovery.toAuthored(offset) ?? recovery.toAuthoredAnchor(offset);
  return locateOffset(lineStarts, Math.max(0, Math.min(mapped, recovery.authoredSource.length)));
}

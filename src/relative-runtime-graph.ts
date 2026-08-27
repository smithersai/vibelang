import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript-js";

export interface RuntimeSourceBudget {
  readonly maximumFileBytes: number;
  readonly maximumTotalBytes: number;
  readonly maximumFiles: number;
}

export interface RuntimeGraphSeed {
  readonly fileName: string;
  readonly source: string;
  readonly bytes: number;
}

export interface RuntimeOutputReservation {
  readonly sourceFileName: string;
  readonly outputFileName: string;
}

/** Compiler-owned, in-memory runtime source. The caller has already validated issuance. */
export interface GeneratedRuntimeSource {
  readonly sourceFileName: string;
  readonly source: string;
  readonly outputFileName: string;
  readonly resolutionAliases: readonly string[];
}

export interface RelativeRuntimeFile {
  readonly fileName: string;
  readonly displayName: string;
  readonly source: string;
  readonly rewrittenSource: string;
  readonly outputFileName: string;
  readonly format: "esm" | "cjs";
  readonly resolutionAliases: readonly string[];
}

/**
 * One project file this walk reached and read, addressed the way a backend that
 * builds its own program needs it: the canonical path, the project-relative name,
 * and the authored bytes. No output is implied — a staged source is an *input*
 * another compiler has to be told about, not something this graph will emit.
 */
export interface StagedProjectSource {
  readonly fileName: string;
  readonly displayName: string;
  readonly source: string;
}

export interface RelativeRuntimeGraph {
  readonly files: readonly RelativeRuntimeFile[];
  /** Fail-closed trust failures for statically evaluated foreign modules. */
  readonly diagnostics: readonly RuntimeGraphDiagnostic[];
  /**
   * Foreign sources the checker must see but the runtime never loads: a
   * `import type` edge, and any `.d.ts`/`.ts` reached only through one. They
   * carry no output and no initialization trust obligation, which is why they
   * are absent from `files` — but a backend that assembles its own program must
   * still be handed them or the type they name resolves to nothing.
   */
  readonly checkerDependencies: readonly StagedProjectSource[];
  /**
   * Non-code project files a Smithers source named as an asset, present only
   * when the caller asked for `assetSpecifiers: "stage"`. See that option.
   */
  readonly stagedAssets: readonly StagedProjectSource[];
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly additionalRuntimeOutputs: readonly {
    readonly sourceFileName: string;
    readonly outputFileName: string;
    readonly resolutionAliases: readonly string[];
    readonly stripImportAttributes?: boolean;
  }[];
  /** Rewrite literal dynamic imports which survive Smithers's static-import pass. */
  readonly rewriteSmithersRuntimeCalls: (
    code: string,
    authoredFileName: string,
    outputFileName: string,
  ) => string;
}

export interface RuntimeGraphDiagnostic {
  readonly code: "SMITHERS1510";
  readonly severity: "error";
  readonly message: string;
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
}

export interface TranspiledRuntimeFile extends RelativeRuntimeFile {
  readonly code: string;
  readonly sourceMap?: string;
  /** Virtual checker input; runtime bytes are still `code`. */
  readonly validationCode: string;
  /** Type-preserving input used by the declaration emitter. */
  readonly declarationCode: string;
}

export interface TranspiledRuntimeGraph {
  readonly files: readonly TranspiledRuntimeFile[];
  readonly diagnostics: readonly ts.Diagnostic[];
}

interface ModuleEdge {
  readonly kind: "import" | "export" | "import-equals" | "dynamic-import" | "require";
  readonly specifier: string;
  readonly start: number;
  readonly end: number;
  readonly typeOnly: boolean;
  /** True when evaluating the importing module immediately evaluates this edge. */
  readonly moduleInitialization: boolean;
  /**
   * True when the edge carries a `with { ... }` attribute bag. An attribute bag
   * selects a loader, and the loader — not the extension — decides whether the
   * target is code or an asset, so this is the one spelling that makes
   * `./thing.ts` an asset.
   */
  readonly attributes: boolean;
}

interface LoadedForeignFile {
  readonly fileName: string;
  readonly displayName: string;
  readonly source: string;
  readonly outputFileName: string;
  readonly format: "esm" | "cjs";
  readonly edges: readonly ResolvedEdge[];
  readonly aliases: Set<string>;
}

interface ResolvedEdge extends ModuleEdge {
  readonly targetFileName?: string;
  readonly targetOutputFileName?: string;
}

const FOREIGN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const DECLARATION_PATTERN = /\.d\.(?:ts|mts|cts)$/i;
const RESOLUTION_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  checkJs: true,
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.React,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function displayPath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

function extensionOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".d.mts")) return ".d.mts";
  if (lower.endsWith(".d.cts")) return ".d.cts";
  if (lower.endsWith(".d.ts")) return ".d.ts";
  return extname(lower);
}

function formatOf(fileName: string): "esm" | "cjs" {
  const extension = extensionOf(fileName);
  return extension === ".cts" || extension === ".cjs" ? "cjs" : "esm";
}

function outputExtension(fileName: string): ".mjs" | ".cjs" {
  return formatOf(fileName) === "cjs" ? ".cjs" : ".mjs";
}

function readBoundedUtf8(fileName: string, maximumBytes: number): {
  readonly source: string;
  readonly bytes: number;
  readonly dev: number;
  readonly ino: number;
} {
  if (lstatSync(fileName).isSymbolicLink()) {
    throw new TypeError(`relative runtime dependency may not be a symbolic link: ${fileName}`);
  }
  const descriptor = openSync(fileName, "r");
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new TypeError(`relative runtime dependency must be a regular file: ${fileName}`);
    if (metadata.size > maximumBytes) {
      throw new TypeError(`relative runtime dependency exceeds ${maximumBytes} bytes: ${fileName}`);
    }
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maximumBytes) {
      throw new TypeError(`relative runtime dependency exceeds ${maximumBytes} bytes: ${fileName}`);
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new TypeError(`relative runtime dependency is not valid UTF-8: ${fileName}`);
    }
    return { source, bytes: offset, dev: metadata.dev, ino: metadata.ino };
  } finally {
    closeSync(descriptor);
  }
}

function scriptKind(fileName: string): ts.ScriptKind {
  switch (extensionOf(fileName)) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function allNamedImportsAreTypeOnly(clause: ts.ImportClause): boolean {
  const bindings = clause.namedBindings;
  return !clause.name && bindings !== undefined && ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function allNamedExportsAreTypeOnly(clause: ts.ExportDeclaration): boolean {
  return Boolean(clause.exportClause && ts.isNamedExports(clause.exportClause) &&
    clause.exportClause.elements.length > 0 && clause.exportClause.elements.every((element) => element.isTypeOnly));
}

function literalText(expression: ts.Expression | undefined): string | undefined {
  return expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text
    : undefined;
}

function location(sourceFile: ts.SourceFile, position: number): string {
  const point = sourceFile.getLineAndCharacterOfPosition(position);
  return `${sourceFile.fileName}:${point.line + 1}:${point.character + 1}`;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/** The value names one module-scope statement introduces, when they are plain identifiers. */
function declaredValueNames(statement: ts.Statement): readonly string[] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return statement.name ? [statement.name.text] : [];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : []);
  }
  return [];
}

/**
 * Decide which edges of one module are evaluated while that module is being
 * evaluated. The answer defaults to *yes*, and "no" has to be proven.
 *
 * This is the flag that decides which reached modules must carry the
 * initialization trust marker, so an edge misclassified as deferred is an
 * untrusted foreign initializer running with no diagnostic. Until 2026-08-27
 * the two questionable arms answered a different question and defaulted the
 * wrong way: every `import()` was declared not to be initialization, and
 * `require` asked only "is this lexically inside some function". Six spellings
 * were measured checking clean and running the untrusted initializer —
 * `const m = await import(…)`, `const p = import(…); void p`,
 * `await (async () => (await import(…)).x)()`, `const l = (() => require(…))()`,
 * a named local function called at module scope, and an object getter read at
 * module scope. "Lexically inside a function" is not the question; "can module
 * evaluation reach this" is.
 *
 * The proof this walk accepts is deliberately narrow, because it has no
 * checker and no cross-module information — a function defers its body only
 * when module-scope code cannot get hold of the function value at all:
 *
 * - the function literal must *be* a module-scope `function`/`class` member
 *   declaration, or the entire initializer of a module-scope `const`/`let`/`var`
 *   binding — anything else (an IIFE, an array element, an object property, an
 *   argument) hands the value to module-scope code, which may call it;
 * - that declaration must be exported, so the module is written to be driven
 *   from outside; and
 * - none of the names it declares may be mentioned by module-scope code, since
 *   a mention is enough to call it.
 *
 * Everything else is an initialization edge. That deliberately refuses some
 * genuinely deferred shapes — a method reached only through a non-exported
 * factory, `module.exports = { load: () => require(…) }`, a lazily read
 * property of an exported object literal — and the escape hatch for each is the
 * one the diagnostic already names: mark the reached module, or load it through
 * a checked async foreign adapter. Refusing a deferred edge asks for a marker;
 * admitting an initialization edge runs untrusted code, so the asymmetry is the
 * whole point.
 *
 * Note also that only a function's BODY and its parameter defaults are
 * evaluated when it is called. Its decorators, computed member name and type
 * annotations are evaluated where the function is written, so an edge sitting
 * in one of those is at module scope even though it is lexically "inside a
 * function", and the climb below keeps walking outward for exactly that case.
 */
function moduleInitializationClassifier(sourceFile: ts.SourceFile): (node: ts.Node) => boolean {
  let moduleScopeValueNames: Set<string> | undefined;
  const exportedByClause = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || statement.moduleSpecifier) continue;
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (!element.isTypeOnly) exportedByClause.add((element.propertyName ?? element.name).text);
    }
  }

  const collectModuleScopeUses = (): Set<string> => {
    const names = new Set<string>();
    const visit = (node: ts.Node): void => {
      // A type position is erased before anything runs, and an import or export
      // clause names a binding rather than calling it.
      if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ||
        ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isIdentifier(node)) {
        const parent = node.parent as ts.Node & { readonly name?: ts.Node; readonly propertyName?: ts.Node };
        // `{ load }` is a reference written in name position; every other
        // `name`/`propertyName` slot is a declaration or a member label.
        if (ts.isShorthandPropertyAssignment(parent) ||
          (parent.name !== node && parent.propertyName !== node)) names.add(node.text);
        return;
      }
      const body = (node as ts.Node & { readonly body?: ts.Node }).body;
      ts.forEachChild(node, (child) => {
        if (ts.isFunctionLike(node) && child === body) return;
        visit(child);
      });
    };
    visit(sourceFile);
    return names;
  };

  const provablyDeferred = new Map<ts.Node, boolean>();
  const isProvablyDeferred = (fn: ts.Node): boolean => {
    const cached = provablyDeferred.get(fn);
    if (cached !== undefined) return cached;
    provablyDeferred.set(fn, false);
    const parent = fn.parent as ts.Node | undefined;
    let statement: ts.Node | undefined;
    if (ts.isFunctionDeclaration(fn)) statement = fn;
    else if (parent && ts.isClassDeclaration(parent)) statement = parent;
    else if (parent && ts.isVariableDeclaration(parent) && parent.initializer === fn && ts.isIdentifier(parent.name)) {
      statement = parent.parent.parent;
    }
    if (!statement || !statement.parent || !ts.isSourceFile(statement.parent)) return false;
    const declaration = statement as ts.Statement;
    const names = declaredValueNames(declaration);
    if (!hasExportModifier(declaration) && !names.some((name) => exportedByClause.has(name))) return false;
    moduleScopeValueNames ??= collectModuleScopeUses();
    const answer = !names.some((name) => moduleScopeValueNames!.has(name));
    provablyDeferred.set(fn, answer);
    return answer;
  };

  return (node: ts.Node): boolean => {
    let child: ts.Node = node;
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isFunctionLike(current)) {
        const container = current as ts.SignatureDeclaration & { readonly body?: ts.Node };
        const evaluatedOnCall = child === container.body ||
          (ts.isParameter(child) && container.parameters.indexOf(child) >= 0);
        if (evaluatedOnCall && isProvablyDeferred(current)) return false;
      }
      child = current;
      current = current.parent;
    }
    return true;
  };
}

/**
 * @param deferComputedDynamicSpecifier
 *   Report no edge for `import(expression)` instead of refusing the module.
 *
 *   A computed dynamic specifier is refused by the language on both backends —
 *   `09-foreign-calls/a-computed-dynamic-import-specifier-is-refused` and
 *   `23-asset-imports/a-non-literal-dynamic-asset-import-is-rejected` pin it —
 *   so dropping the edge cannot admit anything. What it changes is *who*
 *   reports it and where. On the reference path the asset pass runs before this
 *   walk and reports it against the import site; a backend that runs its own
 *   asset pass afterwards needs the walk to leave the refusal to it rather than
 *   pre-empt it with a project-level abort that names no location.
 */
function scanEdges(
  source: string,
  fileName: string,
  deferComputedDynamicSpecifier = false,
): readonly ModuleEdge[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const edges: ModuleEdge[] = [];
  const add = (
    kind: ModuleEdge["kind"],
    expression: ts.Expression,
    typeOnly: boolean,
    moduleInitialization: boolean,
    attributes = false,
  ): void => {
    const specifier = literalText(expression);
    if (specifier === undefined) {
      if (kind === "dynamic-import" && deferComputedDynamicSpecifier) return;
      throw new TypeError(`${location(sourceFile, expression.getStart(sourceFile))}: module specifier must be a string literal`);
    }
    edges.push({
      kind,
      specifier,
      start: expression.getStart(sourceFile),
      end: expression.end,
      typeOnly,
      moduleInitialization,
      attributes,
    });
  };
  const isModuleInitializationEdge = moduleInitializationClassifier(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const typeOnly = Boolean(node.importClause?.isTypeOnly ||
        (node.importClause && allNamedImportsAreTypeOnly(node.importClause)));
      add("import", node.moduleSpecifier, typeOnly, !typeOnly, node.attributes !== undefined);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const typeOnly = node.isTypeOnly || allNamedExportsAreTypeOnly(node);
      add("export", node.moduleSpecifier, typeOnly, !typeOnly, node.attributes !== undefined);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (!expression) throw new TypeError(`${location(sourceFile, node.getStart(sourceFile))}: import=require needs a literal`);
      add("import-equals", expression, node.isTypeOnly, !node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      // A literal asset import carries its `with { ... }` bag as a second
      // argument. The bag is never a module edge, so it is validated as an
      // inert object literal and then left exactly where the author wrote it.
      if (node.arguments.length < 1 || node.arguments.length > 2) {
        throw new TypeError(
          `${location(sourceFile, node.getStart(sourceFile))}: dynamic import must have one string literal and at most one attributes object`,
        );
      }
      const attributes = node.arguments[1];
      if (attributes !== undefined && !ts.isObjectLiteralExpression(attributes)) {
        throw new TypeError(
          `${location(sourceFile, attributes.getStart(sourceFile))}: dynamic import attributes must be an object literal`,
        );
      }
      // A dynamic import is a module-initialization edge whenever module
      // evaluation reaches it. `buildRelativeRuntimeGraph` used to justify a
      // blanket `false` here with "a subtree reached solely through import()
      // rejects its Promise and is therefore handled by the ordinary checked
      // async foreign-call boundary" — which is true of a `.sm` doing the
      // import, and false of a FOREIGN module doing `await import(…)` at its
      // own module scope, where the load is part of module evaluation and there
      // is no checked call boundary anywhere near it.
      add("dynamic-import", node.arguments[0]!, false, isModuleInitializationEdge(node), attributes !== undefined);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      if (node.arguments.length !== 1) {
        throw new TypeError(`${location(sourceFile, node.getStart(sourceFile))}: require must have one string literal`);
      }
      add("require", node.arguments[0]!, false, isModuleInitializationEdge(node));
    } else if (ts.isIdentifier(node) && node.text === "require" &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      throw new TypeError(
        `${location(sourceFile, node.getStart(sourceFile))}: require may not be aliased or accessed indirectly`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edges.sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * The module-initialization trust marker, matched the way every other
 * implementation of this rule matches it.
 *
 * There are four walks over this one marker — `poc/src/language/semantic.ts`
 * (twice), `compiler/forkbridge/lowering.go.txt`, and this file — and this is
 * the only one that reaches a module at depth two or more, because
 * `checkForeignModuleInitializers` iterates the authored `.sm`'s own statements
 * and the fork's `checkForeignModuleTrust` does the same. A form this walk
 * accepts and the other three refuse is therefore not a cosmetic divergence: it
 * is trust granted at a position no other walk inspects. Until 2026-08-27 this
 * site carried `/i` on both patterns while the other three deliberately did
 * not, and eight miscasings — `@MODULE`, `@Module`, `@mOdUlE`, `@THROWS`,
 * `@Throws`, `{Never}`, `{NEVER}`, `{nEvEr}` — were refused directly and
 * accepted transitively, with the untrusted initializer measured running.
 *
 * Three properties are load-bearing, and all three are chosen to agree with
 * `exactModuleMarker`/`exactThrowsNeverMarker` in the fork byte for byte:
 *
 * 1. **Exact case.** specification/failures.mdx, Foreign Exceptions (Locked):
 *    "`@throws {never}` removes the default panic case; `@throws {T}` declares
 *    the stated foreign error channel." Those are two productions of one
 *    syntax, separated only by the spelling inside the braces. `T` is a
 *    TypeScript type name and TypeScript type identity is case-sensitive, so
 *    `Never` is the second production and never the first. Folding case merges
 *    them and converts a channel the compiler could not reify into the trusted
 *    opt-out, which is the fail-open direction. A JSDoc tag name is not
 *    case-folded by the parser either, so `@THROWS` and `@MODULE` are not the
 *    tags the specification names.
 * 2. **JSDoc whitespace is `[ \t\r\n]`, not `\s`.** `\s` also matches U+00A0,
 *    U+000B, U+000C and U+FEFF, and `isJSDocWhitespace` in the fork accepts
 *    exactly four bytes. `{<NBSP>never<NBSP>}` names a type whose spelling is
 *    not `never`, so by the same two-productions argument the accepting side
 *    was the wrong one.
 * 3. **The comment must be a JSDoc comment the scanner produced**, not a `/**`
 *    substring of the leading text. Scanning raw text for a `/**`-to-close-
 *    delimiter span honours a marker the parser attaches to nothing: a `//`
 *    line comment whose text happens to contain the marker is one line comment
 *    and no JSDoc, and a plain `/*` block comment whose text contains the
 *    marker is one block comment and no JSDoc, and both used to confer trust
 *    here. The scanner's comment kind, plus the fork's own test that the
 *    comment opens with two asterisks and is not the empty `/**` form, is what
 *    separates a JSDoc from a block comment — and it is asked of the scanner
 *    rather than of a regular expression over raw bytes. The parser's attached
 *    `jsDoc` array is deliberately NOT the source: TypeScript attaches only the
 *    LAST block before a statement, which loses the header of every module
 *    written as "module header, then the first export's own doc comment", and
 *    its JSDoc parser strips a `*` decoration inside a tag, which would grant
 *    trust to `conformance/support/split-trust-marker.ts`.
 *
 * The boundary after `@module` stays: `@moduleResolution` is a tag people
 * really write and it claims nothing.
 *
 * This is a deliberate mirror of `JSDOC_SPACE`/`MODULE_MARKER`/
 * `THROWS_NEVER_MARKER`/`leadingJSDocComments` in `poc/src/language/semantic.ts`,
 * kept structurally identical so the two diff cleanly. It cannot be an import:
 * the dependency runs root -> `poc/dist`, and the reference does not export
 * this predicate. If one side moves, move the other in the same shape.
 */
const JSDOC_SPACE = "[ \\t\\r\\n]";
const MODULE_MARKER = new RegExp(`@module(?:${JSDOC_SPACE}|\\*|$)`);
const THROWS_NEVER_MARKER = new RegExp(
  `@throws${JSDOC_SPACE}*\\{${JSDOC_SPACE}*never${JSDOC_SPACE}*\\}`,
);

function leadingJSDocComments(source: string, fileName: string): readonly string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const anchor = sourceFile.statements[0];
  const limit = anchor?.getStart(sourceFile) ?? source.length;
  const comments: string[] = [];
  for (const range of ts.getLeadingCommentRanges(source, anchor?.getFullStart() ?? 0) ?? []) {
    if (range.kind !== ts.SyntaxKind.MultiLineCommentTrivia || range.end > limit) continue;
    const comment = source.slice(range.pos, range.end);
    // `/**/` is an empty block comment, not a JSDoc; this is the same test
    // TypeScript's own scanner makes.
    if (!comment.startsWith("/**") || comment.startsWith("/**/")) continue;
    comments.push(comment);
  }
  return comments;
}

function hasLeadingModuleNoThrowMarker(source: string, fileName: string): boolean {
  return leadingJSDocComments(source, fileName)
    .some((comment) => MODULE_MARKER.test(comment) && THROWS_NEVER_MARKER.test(comment));
}

function resolveSmithersSpecifier(containingFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const exact = resolve(dirname(containingFile), specifier);
  const candidates: string[] = [];
  if (exact.endsWith(".sm")) candidates.push(exact);
  else if (extname(exact) === "") candidates.push(`${exact}.sm`, resolve(exact, "index.sm"));
  else if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.sm`);
  const match = candidates.find((candidate) => existsSync(candidate));
  return match ? realpathSync(match) : undefined;
}

function resolveForeignSpecifier(containingFile: string, specifier: string): {
  readonly canonical: string;
  readonly alias: string;
} | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const alias = resolve(dirname(containingFile), specifier);
  const resolvedModule = ts.resolveModuleName(specifier, containingFile, RESOLUTION_OPTIONS, ts.sys).resolvedModule;
  const explicitExtension = extensionOf(alias);
  const exactRuntime = FOREIGN_EXTENSIONS.has(explicitExtension) && existsSync(alias) ? alias : undefined;
  if (exactRuntime && resolvedModule) {
    const checkerTarget = realpathSync(resolve(resolvedModule.resolvedFileName));
    if (!DECLARATION_PATTERN.test(checkerTarget) && checkerTarget !== realpathSync(exactRuntime)) {
      throw new TypeError(
        `relative runtime import is ambiguous between ${exactRuntime} and checker target ${checkerTarget}`,
      );
    }
  }
  const logical = exactRuntime ?? (resolvedModule ? resolve(resolvedModule.resolvedFileName) : undefined);
  if (!logical || !existsSync(logical)) return undefined;
  const canonical = realpathSync(logical);
  if (canonical !== logical) {
    throw new TypeError(`relative runtime dependency resolves through a symbolic-link alias: ${logical} -> ${canonical}`);
  }
  return { canonical, alias };
}

function rewriteLiterals(source: string, replacements: readonly {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}[]): string {
  let rewritten = source;
  let previousStart = source.length + 1;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    if (replacement.end > previousStart || replacement.start < 0 || replacement.end > source.length) {
      throw new TypeError("relative runtime rewrite contains overlapping or invalid spans");
    }
    rewritten = `${rewritten.slice(0, replacement.start)}${JSON.stringify(replacement.text)}${rewritten.slice(replacement.end)}`;
    previousStart = replacement.start;
  }
  return rewritten;
}

function relativeSpecifier(fromOutput: string, toOutput: string): string {
  let specifier = relative(dirname(fromOutput), toOutput).split(sep).join("/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

function collisionKey(fileName: string): string {
  return process.platform === "win32" || process.platform === "darwin" ? fileName.toLowerCase() : fileName;
}

/**
 * Discover and resolve the bounded relative runtime graph without evaluating
 * authored modules. Type-only edges are intentionally not staged.
 */
export function buildRelativeRuntimeGraph(options: {
  readonly rootDir: string;
  readonly outDir: string;
  readonly smithersSources: readonly RuntimeGraphSeed[];
  readonly smithersOutputs: readonly RuntimeOutputReservation[];
  readonly generatedRuntimeSources?: readonly GeneratedRuntimeSource[];
  /**
   * What to do with a relative specifier a Smithers source spells as an asset.
   *
   * `"reject"` (the default) is the reference path: it compiles assets *before*
   * this walk and hands the results in as `generatedRuntimeSources`, so by the
   * time an asset specifier reaches `resolveEdge` it already resolves to a
   * generated module. Anything still unresolved there is a genuinely missing
   * import and must fail.
   *
   * `"stage"` is for a backend that runs its own asset pass over the raw bytes
   * and therefore has no generated modules to hand in. The specifier is not
   * resolved as code; the file behind it is read and reported in
   * `stagedAssets`, and a specifier naming nothing readable is left alone
   * rather than refused, because deciding whether a missing or unreadable asset
   * is an error belongs to that backend's own asset pass, which reports it
   * against the import site instead of aborting the whole project.
   */
  readonly assetSpecifiers?: "reject" | "stage";
  readonly budget: RuntimeSourceBudget;
}): RelativeRuntimeGraph {
  const rootDir = realpathSync(resolve(options.rootDir));
  const outDir = resolve(options.outDir);
  const smithersByName = new Map(options.smithersSources.map((source) => [resolve(source.fileName), source]));
  let totalBytes = options.smithersSources.reduce((total, source) => total + source.bytes, 0);
  let fileCount = options.smithersSources.length;
  if (fileCount > options.budget.maximumFiles || totalBytes > options.budget.maximumTotalBytes) {
    throw new TypeError("relative runtime project exceeds its source budget");
  }

  const identityOwners = new Map<string, string>();
  for (const source of options.smithersSources) {
    const absolute = resolve(source.fileName);
    const metadata = statSync(absolute);
    const identity = `${metadata.dev}:${metadata.ino}`;
    const prior = identityOwners.get(identity);
    if (prior && prior !== absolute) {
      throw new TypeError(`project sources are hard-link aliases of one file: ${prior} and ${absolute}`);
    }
    identityOwners.set(identity, absolute);
  }

  const outputOwners = new Map<string, string>();
  for (const reservation of options.smithersOutputs) {
    const output = resolve(reservation.outputFileName);
    const key = collisionKey(output);
    const prior = outputOwners.get(key);
    if (prior) throw new TypeError(`runtime outputs collide: ${prior} and ${reservation.sourceFileName}`);
    outputOwners.set(key, reservation.sourceFileName);
  }

  const generatedByName = new Map<string, RelativeRuntimeFile>();
  const generatedByAlias = new Map<string, RelativeRuntimeFile>();
  const generatedEdges = new Map<string, readonly ModuleEdge[]>();
  for (const [index, generated] of (options.generatedRuntimeSources ?? []).entries()) {
    if (
      generated === null || typeof generated !== "object" ||
      typeof generated.sourceFileName !== "string" || generated.sourceFileName.trim() === "" ||
      typeof generated.source !== "string" ||
      typeof generated.outputFileName !== "string" || generated.outputFileName.trim() === "" ||
      !Array.isArray(generated.resolutionAliases) ||
      !generated.resolutionAliases.every((alias) => typeof alias === "string" && alias.trim() !== "")
    ) {
      throw new TypeError(`compiler-generated runtime source ${index} has an invalid shape`);
    }
    const sourceFileName = resolve(rootDir, generated.sourceFileName);
    if (!isInside(rootDir, sourceFileName) || sourceFileName === rootDir) {
      throw new TypeError(`compiler-generated runtime source escapes the project root: ${generated.sourceFileName}`);
    }
    if (
      existsSync(sourceFileName) || smithersByName.has(sourceFileName) ||
      generatedByName.has(sourceFileName) || generatedByAlias.has(sourceFileName)
    ) {
      throw new TypeError(`compiler-generated runtime source collides with a project path: ${sourceFileName}`);
    }
    if (!hasLeadingModuleNoThrowMarker(generated.source, sourceFileName)) {
      throw new TypeError(`compiler-generated runtime source lacks its no-panic marker: ${sourceFileName}`);
    }
    // A nested loader graph is the one shape allowed to carry an edge: the
    // loader declared it through the tracked dependency context, so the only
    // legal target is a sibling generated module in this same batch. Targets
    // are reconciled after every generated identity is registered, because a
    // sibling may be issued later in the list.
    const edges = scanEdges(generated.source, sourceFileName);
    for (const edge of edges) {
      if (edge.kind !== "import" || edge.typeOnly || !edge.specifier.startsWith(".")) {
        throw new TypeError(
          `compiler-generated asset modules may only import a sibling generated module: ${sourceFileName}`,
        );
      }
    }
    generatedEdges.set(sourceFileName, edges);
    const outputFileName = resolve(generated.outputFileName);
    if (!isInside(outDir, outputFileName) || outputFileName === outDir || extname(outputFileName) !== ".mjs") {
      throw new TypeError(`compiler-generated runtime output must be one .mjs file beneath outDir: ${outputFileName}`);
    }
    const outputKey = collisionKey(outputFileName);
    const priorOutput = outputOwners.get(outputKey);
    if (priorOutput !== undefined) {
      throw new TypeError(`runtime outputs collide: ${priorOutput} and ${sourceFileName}`);
    }
    const aliases = [...new Set(generated.resolutionAliases.map((alias) => resolve(rootDir, alias)))].sort(compareText);
    if (aliases.length !== generated.resolutionAliases.length) {
      throw new TypeError(`compiler-generated runtime source ${sourceFileName} contains duplicate aliases`);
    }
    for (const alias of aliases) {
      if (!isInside(rootDir, alias) || alias === rootDir || alias === sourceFileName) {
        throw new TypeError(`compiler-generated runtime alias escapes or aliases its generated identity: ${alias}`);
      }
      if (smithersByName.has(alias) || generatedByName.has(alias) || generatedByAlias.has(alias)) {
        throw new TypeError(`compiler-generated runtime alias conflicts with another project identity: ${alias}`);
      }
    }
    const sourceBytes = Buffer.byteLength(generated.source, "utf8");
    if (sourceBytes > options.budget.maximumFileBytes) {
      throw new TypeError(`compiler-generated runtime source exceeds ${options.budget.maximumFileBytes} bytes: ${sourceFileName}`);
    }
    fileCount += 1;
    totalBytes += sourceBytes;
    if (fileCount > options.budget.maximumFiles || totalBytes > options.budget.maximumTotalBytes) {
      throw new TypeError("relative runtime project exceeds its source budget after generated asset modules");
    }
    outputOwners.set(outputKey, sourceFileName);
    const file: RelativeRuntimeFile = {
      fileName: sourceFileName,
      displayName: displayPath(rootDir, sourceFileName),
      source: generated.source,
      rewrittenSource: generated.source,
      outputFileName,
      format: "esm",
      resolutionAliases: aliases,
    };
    generatedByName.set(sourceFileName, file);
    for (const alias of aliases) generatedByAlias.set(alias, file);
  }

  // Reconcile the nested generated graph now that every identity is known, then
  // restate each sibling edge against the emitted output layout. Both ends live
  // beneath the same generated output directory, so this is a pure extension
  // rewrite that keeps the module's authored offsets intact.
  const generatedReferences = new Map<string, readonly string[]>();
  for (const [sourceFileName, edges] of generatedEdges) {
    const file = generatedByName.get(sourceFileName)!;
    const references: string[] = [];
    const replacements = edges.map((edge) => {
      const target = generatedByName.get(resolve(dirname(sourceFileName), edge.specifier));
      if (!target) {
        throw new TypeError(
          `compiler-generated asset module references an unissued generated module: ${sourceFileName} -> ${edge.specifier}`,
        );
      }
      if (target.fileName === sourceFileName) {
        throw new TypeError(`compiler-generated asset module imports itself: ${sourceFileName}`);
      }
      references.push(target.fileName);
      return {
        start: edge.start,
        end: edge.end,
        text: relativeSpecifier(file.outputFileName, target.outputFileName),
      };
    });
    generatedReferences.set(sourceFileName, references);
    const rewritten: RelativeRuntimeFile = {
      ...file,
      rewrittenSource: rewriteLiterals(file.source, replacements),
    };
    generatedByName.set(sourceFileName, rewritten);
    for (const alias of file.resolutionAliases) generatedByAlias.set(alias, rewritten);
  }
  // A cycle between generated modules would evaluate a const binding in its
  // temporal dead zone, so reject it here rather than emit a program that
  // throws on load.
  const generatedVisited = new Map<string, "visiting" | "done">();
  const visitGenerated = (fileName: string, path: readonly string[]): void => {
    const state = generatedVisited.get(fileName);
    if (state === "done") return;
    if (state === "visiting") {
      throw new TypeError(`compiler-generated asset modules form an import cycle: ${[...path, fileName].join(" -> ")}`);
    }
    generatedVisited.set(fileName, "visiting");
    for (const reference of generatedReferences.get(fileName) ?? []) visitGenerated(reference, [...path, fileName]);
    generatedVisited.set(fileName, "done");
  };
  for (const fileName of [...generatedByName.keys()].sort(compareText)) visitGenerated(fileName, []);

  const pendingRuntime = new Set<string>();
  const pendingChecker = new Set<string>();
  const checkerOnlyFiles = new Set<string>();
  const snapshots = new Map<string, ReturnType<typeof readBoundedUtf8>>();
  const foreignByName = new Map<string, LoadedForeignFile>();
  const staticInitializationRoots = new Set<string>();
  const targetAliases = new Map<string, Set<string>>();
  const resolvedOutputByAlias = new Map<string, string>();
  const stagedAssetByName = new Map<string, StagedProjectSource>();

  /**
   * Read one asset the caller asked to have staged, or decline.
   *
   * Declining is the fail-closed answer, not a shrug: the caller only reaches
   * here with `assetSpecifiers: "stage"`, which means it has an asset pass of
   * its own that reports a missing, unreadable, escaping, or over-budget asset
   * against the import site. Aborting the whole project here would replace that
   * located diagnostic with a thrown project error.
   */
  const reserveAsset = (canonical: string): void => {
    if (stagedAssetByName.has(canonical)) return;
    if (!isInside(rootDir, canonical) || canonical === rootDir) return;
    if (smithersByName.has(canonical) || generatedByName.has(canonical) || generatedByAlias.has(canonical)) {
      throw new TypeError(`relative asset dependency conflicts with a project code identity: ${canonical}`);
    }
    if (foreignByName.has(canonical) || pendingRuntime.has(canonical) ||
      pendingChecker.has(canonical) || checkerOnlyFiles.has(canonical)) {
      throw new TypeError(`relative dependency is loaded both as code and as an asset: ${canonical}`);
    }
    let snapshot: ReturnType<typeof readBoundedUtf8>;
    try {
      if (!existsSync(canonical) || lstatSync(canonical).isSymbolicLink()) return;
      snapshot = readBoundedUtf8(canonical, options.budget.maximumFileBytes);
    } catch {
      // Unreadable, over budget, or not UTF-8 — the wire protocol carries text,
      // so there is nothing to stage. The importing backend still sees the
      // import and refuses it there.
      return;
    }
    if (fileCount >= options.budget.maximumFiles) return;
    if (totalBytes + snapshot.bytes > options.budget.maximumTotalBytes) return;
    fileCount += 1;
    totalBytes += snapshot.bytes;
    stagedAssetByName.set(canonical, {
      fileName: canonical,
      displayName: displayPath(rootDir, canonical),
      source: snapshot.source,
    });
  };

  /**
   * True when a Smithers source spelled this edge as an asset rather than as code.
   *
   * Project code is never an asset however it is spelled, so `.sm`, a foreign
   * source extension, and a declaration file are all excluded before the two
   * asset spellings are considered — an extensionless specifier included, since
   * that is how a `.sm` sibling is named. Getting that order wrong classified
   * `./helper.sm` as an asset, because `.sm` is not a *foreign* extension.
   */
  const namesAnAsset = (edge: ModuleEdge, literal: string): boolean => {
    if (options.assetSpecifiers !== "stage") return false;
    const extension = extensionOf(literal);
    if (extension === "" || extension === ".sm" || DECLARATION_PATTERN.test(literal)) return false;
    if (FOREIGN_EXTENSIONS.has(extension)) return edge.attributes;
    return true;
  };

  const reserveForeign = (canonical: string, alias: string): string => {
    if (!isInside(rootDir, canonical) || canonical === rootDir) {
      throw new TypeError(`relative runtime dependency is outside the project root: ${canonical}`);
    }
    if (stagedAssetByName.has(canonical)) {
      throw new TypeError(`relative dependency is loaded both as code and as an asset: ${canonical}`);
    }
    const extension = extensionOf(canonical);
    if (generatedByAlias.has(alias) || generatedByName.has(canonical)) {
      throw new TypeError(`relative runtime dependency conflicts with a compiler-generated asset identity: ${alias}`);
    }
    if (DECLARATION_PATTERN.test(canonical)) {
      throw new TypeError(`runtime import resolves only to a declaration file: ${canonical}`);
    }
    if (!FOREIGN_EXTENSIONS.has(extension)) {
      throw new TypeError(`unsupported relative runtime dependency '${canonical}' (${extension || "no extension"})`);
    }
    const relativeName = displayPath(rootDir, canonical);
    const emittedRelative = relativeName.replace(/\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/i, outputExtension(canonical));
    const output = resolve(outDir, "__smithers_foreign__", emittedRelative);
    const outputKey = collisionKey(output);
    const priorOwner = outputOwners.get(outputKey);
    if (priorOwner && priorOwner !== canonical) {
      throw new TypeError(`runtime outputs collide: ${priorOwner} and ${canonical} -> ${output}`);
    }
    outputOwners.set(outputKey, canonical);
    const aliases = targetAliases.get(canonical) ?? new Set<string>();
    aliases.add(alias);
    targetAliases.set(canonical, aliases);
    const priorAlias = resolvedOutputByAlias.get(alias);
    if (priorAlias && priorAlias !== output) {
      throw new TypeError(`relative runtime specifier is ambiguous at ${alias}`);
    }
    resolvedOutputByAlias.set(alias, output);
    resolvedOutputByAlias.set(canonical, output);
    pendingChecker.delete(canonical);
    if (!foreignByName.has(canonical)) pendingRuntime.add(canonical);
    return output;
  };

  const reserveCheckerDependency = (canonical: string): void => {
    if (!isInside(rootDir, canonical) || canonical === rootDir) {
      throw new TypeError(`relative checker dependency is outside the project root: ${canonical}`);
    }
    const extension = extensionOf(canonical);
    if (!DECLARATION_PATTERN.test(canonical) && !FOREIGN_EXTENSIONS.has(extension)) {
      throw new TypeError(`unsupported relative checker dependency '${canonical}' (${extension || "no extension"})`);
    }
    if (!foreignByName.has(canonical) && !pendingRuntime.has(canonical) && !checkerOnlyFiles.has(canonical)) {
      pendingChecker.add(canonical);
    }
  };

  const resolveEdge = (
    containingFile: string,
    containingOutput: string,
    edge: ModuleEdge,
    fromSmithers: boolean,
    checkerOnly = false,
  ): ResolvedEdge => {
    const importerFormat = fromSmithers ? "esm" : formatOf(containingFile);
    if (!checkerOnly && !edge.typeOnly && importerFormat === "esm" &&
      (edge.kind === "require" || edge.kind === "import-equals")) {
      throw new TypeError(
        `${containingFile}: ESM sources cannot use ${edge.kind === "require" ? "require()" : "import=require"}; ` +
        "use import syntax or a .cjs/.cts module",
      );
    }
    if (!checkerOnly && !edge.typeOnly && importerFormat === "cjs" && edge.kind === "dynamic-import") {
      throw new TypeError(`${containingFile}: dynamic import from bounded CJS output is not yet supported`);
    }
    // An asset specifier is not a module edge, so it is answered before every
    // rule below that describes one — the same position the reference path's
    // `generatedByAlias` hit occupies, and for the same reason: an asset has
    // already been resolved by an asset pass, and neither the Smithers dynamic
    // import deferral nor the foreign-code resolver has anything to say about
    // it. This is reached only under `assetSpecifiers: "stage"`.
    if (fromSmithers && edge.specifier.startsWith(".")) {
      const literal = resolve(dirname(containingFile), edge.specifier);
      if (namesAnAsset(edge, literal)) {
        reserveAsset(literal);
        return edge;
      }
    }
    // A compiler-generated asset module is content the compiler itself wrote at
    // a path it owns, so its exact rewrite map is already known. That is the one
    // literal dynamic import a Smithers module may spell; every other Smithers dynamic
    // edge still waits on the frontend.
    const generated = fromSmithers && edge.specifier.startsWith(".")
      ? generatedByAlias.get(resolve(dirname(containingFile), edge.specifier))
      : undefined;
    if (fromSmithers && !edge.typeOnly && edge.kind === "dynamic-import" && generated === undefined) {
      throw new TypeError(
        `${containingFile}: Smithers dynamic import is deferred until the frontend can preserve its exact rewrite map`,
      );
    }
    if (!edge.specifier.startsWith(".")) return edge;
    if (fromSmithers) {
      if (generated !== undefined) {
        if (edge.typeOnly ||
          (edge.kind !== "import" && edge.kind !== "export" && edge.kind !== "dynamic-import")) {
          throw new TypeError(
            `${containingFile}: compiler-generated assets require a static import, a re-export, ` +
            "or a literal dynamic import that binds the module at runtime",
          );
        }
        return {
          ...edge,
          targetFileName: generated.fileName,
          targetOutputFileName: generated.outputFileName,
        };
      }
      const smithersTarget = resolveSmithersSpecifier(containingFile, edge.specifier);
      if (smithersTarget) {
        if (!smithersByName.has(smithersTarget)) {
          throw new TypeError(`relative Smithers dependency was not loaded into the project: ${smithersTarget}`);
        }
        if (!edge.typeOnly && (edge.kind === "require" || edge.kind === "import-equals")) {
          throw new TypeError(`Smithers modules may only load another .sm module through a static import/export: ${containingFile}`);
        }
        return { ...edge, targetFileName: smithersTarget };
      }
      // Preserve the language frontend's source-located missing-module
      // diagnostic for an explicitly authored Smithers edge.
      if (edge.specifier.endsWith(".sm")) return edge;
    }
    const foreign = resolveForeignSpecifier(containingFile, edge.specifier);
    if (!foreign) {
      const graph = edge.typeOnly || checkerOnly ? "checker dependency" : "runtime import";
      throw new TypeError(`${containingFile}: unresolved relative ${graph} ${JSON.stringify(edge.specifier)}`);
    }
    if (smithersByName.has(foreign.canonical)) {
      throw new TypeError(`foreign modules may not import a .sm implementation: ${containingFile}`);
    }
    if (edge.typeOnly || checkerOnly) {
      reserveCheckerDependency(foreign.canonical);
      return { ...edge, targetFileName: foreign.canonical };
    }
    const targetOutput = reserveForeign(foreign.canonical, foreign.alias);
    const targetFormat = formatOf(foreign.canonical);
    if (importerFormat === "cjs" && edge.kind !== "dynamic-import" && targetFormat === "esm") {
      throw new TypeError(`${containingFile}: bounded CJS output cannot synchronously load ESM module ${foreign.canonical}`);
    }
    return {
      ...edge,
      targetFileName: foreign.canonical,
      targetOutputFileName: targetOutput,
    };
  };

  for (const source of options.smithersSources) {
    const absolute = resolve(source.fileName);
    const output = options.smithersOutputs.find((candidate) => resolve(candidate.sourceFileName) === absolute)?.outputFileName;
    if (!output) throw new TypeError(`Smithers runtime output is missing for ${absolute}`);
    for (const edge of scanEdges(source.source, absolute, options.assetSpecifiers === "stage")) {
      const resolvedEdge = resolveEdge(absolute, resolve(output), edge, true);
      if (resolvedEdge.moduleInitialization && resolvedEdge.targetFileName &&
        !smithersByName.has(resolvedEdge.targetFileName) && !generatedByName.has(resolvedEdge.targetFileName)) {
        staticInitializationRoots.add(resolvedEdge.targetFileName);
      }
    }
  }

  const loadSnapshot = (fileName: string): ReturnType<typeof readBoundedUtf8> => {
    const existing = snapshots.get(fileName);
    if (existing) return existing;
    if (fileCount >= options.budget.maximumFiles) {
      throw new TypeError(`relative runtime project exceeds ${options.budget.maximumFiles} source files`);
    }
    const snapshot = readBoundedUtf8(fileName, options.budget.maximumFileBytes);
    const identity = `${snapshot.dev}:${snapshot.ino}`;
    const priorIdentity = identityOwners.get(identity);
    if (priorIdentity && priorIdentity !== fileName) {
      throw new TypeError(`project sources are hard-link aliases of one file: ${priorIdentity} and ${fileName}`);
    }
    identityOwners.set(identity, fileName);
    fileCount += 1;
    totalBytes += snapshot.bytes;
    if (totalBytes > options.budget.maximumTotalBytes) {
      throw new TypeError(`relative runtime project exceeds ${options.budget.maximumTotalBytes} source bytes`);
    }
    snapshots.set(fileName, snapshot);
    return snapshot;
  };

  while (pendingRuntime.size > 0 || pendingChecker.size > 0) {
    const runtime = pendingRuntime.size > 0;
    const selected = runtime ? pendingRuntime : pendingChecker;
    const fileName = [...selected].sort(compareText)[0]!;
    selected.delete(fileName);
    if (runtime ? foreignByName.has(fileName) : foreignByName.has(fileName) || checkerOnlyFiles.has(fileName)) continue;
    const snapshot = loadSnapshot(fileName);
    if (!runtime) {
      for (const edge of scanEdges(snapshot.source, fileName)) {
        resolveEdge(fileName, fileName, edge, false, true);
      }
      checkerOnlyFiles.add(fileName);
      continue;
    }
    const relativeName = displayPath(rootDir, fileName);
    const output = resolvedOutputByAlias.get(fileName);
    if (!output) throw new TypeError(`relative runtime output is missing for ${fileName}`);
    const edges = scanEdges(snapshot.source, fileName).map((edge) => resolveEdge(fileName, output, edge, false));
    foreignByName.set(fileName, {
      fileName,
      displayName: relativeName,
      source: snapshot.source,
      outputFileName: output,
      format: formatOf(fileName),
      edges,
      aliases: targetAliases.get(fileName) ?? new Set(),
    });
  }

  const foreignFiles = [...foreignByName.values()].sort((left, right) => compareText(left.fileName, right.fileName))
    .map((file): RelativeRuntimeFile => ({
      fileName: file.fileName,
      displayName: file.displayName,
      source: file.source,
      rewrittenSource: rewriteLiterals(file.source, file.edges.flatMap((edge) =>
        edge.targetOutputFileName
          ? [{ start: edge.start, end: edge.end, text: relativeSpecifier(file.outputFileName, edge.targetOutputFileName) }]
          : [])),
      outputFileName: file.outputFileName,
      format: file.format,
      resolutionAliases: [...file.aliases].sort(compareText),
    }));
  const files = [...generatedByName.values(), ...foreignFiles]
    .sort((left, right) => compareText(left.fileName, right.fileName));
  // Every path this compilation will write. A dynamic specifier the frontend
  // already restated against one of them is finished, so the rewrite below
  // stays idempotent no matter which stage performed it.
  const emittedOutputs = new Set([
    ...files.map((file) => collisionKey(file.outputFileName)),
    ...options.smithersOutputs.map((reservation) => collisionKey(resolve(reservation.outputFileName))),
  ]);

  // Only the graph module evaluation actually reaches needs an initialization
  // trust claim, and `moduleInitialization` is what decides that, one edge at a
  // time, in `scanEdges`. Its default is "initialization" and "deferred" is the
  // case that must be proven — see `moduleInitializationClassifier` for the
  // proof it accepts. The flag is read here and at the `.sm` seed loop above;
  // on a `.sm` edge it is inert, because a Smithers dynamic import either
  // resolves to a compiler-generated asset (never a trust root) or is refused
  // outright a few lines into `resolveEdge`. It is foreign modules — reached at
  // depth one and beyond, where no other implementation of this rule looks —
  // whose edges this classification actually governs.
  const initializationRequired = new Set<string>();
  const initializationPending = [...staticInitializationRoots].sort(compareText);
  while (initializationPending.length > 0) {
    const fileName = initializationPending.shift()!;
    if (initializationRequired.has(fileName)) continue;
    initializationRequired.add(fileName);
    const file = foreignByName.get(fileName);
    if (!file) continue;
    for (const edge of file.edges) {
      if (!edge.moduleInitialization || !edge.targetFileName ||
        !foreignByName.has(edge.targetFileName) || initializationRequired.has(edge.targetFileName)) continue;
      initializationPending.push(edge.targetFileName);
    }
    initializationPending.sort(compareText);
  }
  const diagnostics: RuntimeGraphDiagnostic[] = [...initializationRequired]
    .sort(compareText)
    .flatMap((fileName) => {
      const file = foreignByName.get(fileName);
      if (!file || hasLeadingModuleNoThrowMarker(file.source, file.fileName)) return [];
      const parsed = ts.createSourceFile(file.fileName, file.source, ts.ScriptTarget.Latest, true, scriptKind(file.fileName));
      const position = parsed.getLineAndCharacterOfPosition(parsed.statements[0]?.getStart(parsed) ?? 0);
      return [{
        code: "SMITHERS1510" as const,
        severity: "error" as const,
        message: "foreign module initialization can panic before a checked call boundary; add a leading JSDoc containing both @module and @throws {never}, or load it with dynamic import inside a checked async foreign adapter",
        fileName: file.fileName,
        line: position.line + 1,
        column: position.character + 1,
      }];
    });

  return {
    files,
    diagnostics,
    checkerDependencies: [...checkerOnlyFiles].sort(compareText).map((fileName) => ({
      fileName,
      displayName: displayPath(rootDir, fileName),
      source: snapshots.get(fileName)!.source,
    })),
    stagedAssets: [...stagedAssetByName.keys()].sort(compareText).map((fileName) => stagedAssetByName.get(fileName)!),
    fileCount,
    totalBytes,
    additionalRuntimeOutputs: files.map((file) => ({
      sourceFileName: file.fileName,
      outputFileName: file.outputFileName,
      resolutionAliases: file.resolutionAliases,
      ...(generatedByName.has(file.fileName) ? { stripImportAttributes: true as const } : {}),
    })),
    rewriteSmithersRuntimeCalls(code, authoredFileName, outputFileName) {
      const calls = scanEdges(code, outputFileName).filter((edge) => edge.kind === "dynamic-import");
      const replacements = calls.flatMap((edge) => {
        if (!edge.specifier.startsWith(".")) return [];
        const alias = resolve(dirname(authoredFileName), edge.specifier);
        // A literal dynamic asset import survives the frontend's static pass, so
        // the generated identity is resolved here beside the foreign graph.
        const targetOutput = generatedByAlias.get(alias)?.outputFileName ?? resolvedOutputByAlias.get(alias);
        if (!targetOutput) {
          if (emittedOutputs.has(collisionKey(resolve(dirname(outputFileName), edge.specifier)))) return [];
          throw new TypeError(`${authoredFileName}: unresolved emitted dynamic import ${JSON.stringify(edge.specifier)}`);
        }
        return [{ start: edge.start, end: edge.end, text: relativeSpecifier(outputFileName, targetOutput) }];
      });
      return rewriteLiterals(code, replacements);
    },
  };
}

function declarationInput(file: RelativeRuntimeFile, javascript: string): string {
  // The declaration emitter parses virtual `.mjs` inputs as TS. JSX must first
  // be erased; non-JSX TypeScript retains its authored type information.
  const extension = extensionOf(file.fileName);
  if (extension === ".tsx" || extension === ".jsx") return `// @ts-nocheck\n${javascript}`;
  if (extension === ".cjs") return `${file.rewrittenSource}\nexport default module.exports\n`;
  return file.rewrittenSource;
}

function validationInput(file: RelativeRuntimeFile, javascript: string): string {
  const extension = extensionOf(file.fileName);
  if (extension === ".cjs") return `// @ts-nocheck\n${javascript}\nexport default module.exports\n`;
  if (extension === ".tsx" || extension === ".jsx") return `// @ts-nocheck\n${javascript}`;
  return file.rewrittenSource;
}

/** Transpile the already-resolved graph; this performs no writes. */
export function transpileRelativeRuntimeGraph(
  graph: RelativeRuntimeGraph,
  options: { readonly sourceMap?: boolean },
): TranspiledRuntimeGraph {
  const diagnostics: ts.Diagnostic[] = [];
  const files = graph.files.map((file): TranspiledRuntimeFile => {
    const emitted = ts.transpileModule(file.rewrittenSource, {
      fileName: file.fileName,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: file.format === "cjs" ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
        moduleResolution: file.format === "cjs"
          ? ts.ModuleResolutionKind.Node10
          : ts.ModuleResolutionKind.Bundler,
        allowJs: true,
        checkJs: true,
        jsx: ts.JsxEmit.React,
        sourceMap: options.sourceMap,
        inlineSources: options.sourceMap,
      },
      reportDiagnostics: true,
    });
    diagnostics.push(...(emitted.diagnostics ?? []).filter((diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error));
    let code = emitted.outputText.replace(/\n?\/\/# sourceMappingURL=.*(?:\r?\n)?$/, "").trimEnd() + "\n";
    let sourceMap: string | undefined;
    if (options.sourceMap) {
      if (!emitted.sourceMapText) {
        diagnostics.push({
          category: ts.DiagnosticCategory.Error,
          code: 95001,
          file: undefined,
          start: undefined,
          length: undefined,
          messageText: `TypeScript emitted no source map for ${file.fileName}`,
        });
      } else {
        const parsed = JSON.parse(emitted.sourceMapText) as Record<string, unknown> & {
          version: number;
          sources: string[];
        };
        if (parsed.version !== 3 || !Array.isArray(parsed.sources) || parsed.sources.length !== 1) {
          throw new TypeError(`foreign source map has an unsupported shape: ${file.fileName}`);
        }
        let source = relative(dirname(file.outputFileName), file.fileName).split(sep).join("/");
        if (!source.startsWith(".")) source = `./${source}`;
        parsed.file = basename(file.outputFileName);
        parsed.sources = [source];
        parsed.sourcesContent = [file.source];
        sourceMap = JSON.stringify(parsed);
        code += `//# sourceMappingURL=${basename(file.outputFileName)}.map\n`;
      }
    }
    return {
      ...file,
      code,
      sourceMap,
      validationCode: validationInput(file, code),
      declarationCode: declarationInput(file, code),
    };
  });
  return { files, diagnostics };
}

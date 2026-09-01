import { dirname, resolve } from "node:path";
import * as ts from "typescript-js";
import type { FunctionRows } from "./model.ts";
import { DECLARATION_EFFECT_TAG, DECLARATION_EFFECT_VERSION } from "./model.ts";
import { createEmittedModuleResolver, type EmittedModuleResolutionOptions } from "./validate.ts";

// Re-exported from their declaring module so this file stays the public home of
// the declaration-metadata surface while the frontend can read the tag without
// importing this module. @see model.ts
export { DECLARATION_EFFECT_TAG, DECLARATION_EFFECT_VERSION };

export interface DeclarationSource {
  readonly fileName: string;
  readonly code: string;
  /** Compiler-inferred rows to preserve for exported function declarations. */
  readonly effects?: Readonly<Record<string, FunctionRows>>;
  /**
   * The runtime module specifier this lowered module was emitted against, as
   * the lowering phase wrote it. Channel normalization rewrites only `Result`
   * references that resolve to this module's `Result` export, so a caller that
   * knows its own runtime states it here rather than letting the emitter infer
   * it. When absent it is recovered from the compiler-written header of
   * `code`; when neither is available no channel is normalized.
   */
  readonly runtimeModule?: string;
}

export interface DeclarationOutput {
  readonly fileName: string;
  readonly code: string;
}

export interface DeclarationEmitResult {
  readonly outputs: readonly DeclarationOutput[];
  readonly diagnostics: readonly ts.Diagnostic[];
  readonly ok: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function declarationOutputName(fileName: string): string {
  if (/\.(?:mts|mjs)$/.test(fileName)) return fileName.replace(/\.(?:mts|mjs)$/, ".d.mts");
  if (/\.(?:cts|cjs)$/.test(fileName)) return fileName.replace(/\.(?:cts|cjs)$/, ".d.cts");
  return fileName.replace(/\.(?:tsx?|jsx?)$/, ".d.ts");
}

/**
 * A row member is an identifier, optionally module-qualified as
 * `Name@module/path` when two project modules declare the same nominal name.
 * The qualifier mirrors the module identity used for runtime Error
 * registration, so declaration metadata and runtime identities agree.
 */
const ROW_MEMBER = /^[$A-Z_a-z][$0-9A-Z_a-z]*(?:@[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)?$/;

function isRowMemberName(item: unknown): boolean {
  return typeof item === "string" && item.length <= 256 && ROW_MEMBER.test(item);
}

function exactSortedNames(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 1_024 || !value.every(isRowMemberName)) {
    throw new TypeError(`${label} must be an array of identifier names`);
  }
  const sorted = [...value].sort(compareText);
  if (sorted.some((item, index) => item !== value[index]) || new Set(sorted).size !== sorted.length) {
    throw new TypeError(`${label} must be sorted and unique`);
  }
  return Object.freeze(sorted);
}

function canonicalNames(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 1_024 || !value.every(isRowMemberName)) {
    throw new TypeError(`${label} must be an array of identifier names`);
  }
  const sorted = [...value].sort(compareText);
  if (new Set(sorted).size !== sorted.length) throw new TypeError(`${label} must be unique`);
  return Object.freeze(sorted);
}

function statementDeclarationName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name) return statement.name.text;
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0]!;
    return ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
  }
  return undefined;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) &&
    Boolean(ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

interface ChannelTypeReference {
  readonly head: string;
  readonly arguments: readonly ts.TypeNode[];
  readonly rebuild: (arguments_: readonly ts.TypeNode[]) => ts.TypeNode;
}

/** The runtime export whose channel unions this pass is allowed to collapse. */
const RUNTIME_CHANNEL_EXPORT = "Result";

/** Written by `emitHelperImport` (`./compile.ts`) ahead of every lowered body. */
const GENERATED_HEADER_BANNER = /^\/\/ Generated from .+ by the Smithers checked POC\.$/;

/** How far a compiler-generated return channel may sit under its wrappers. */
const CHANNEL_DEPTH_LIMIT = 8;

/**
 * Module identity for a specifier, independent of the extension the emitter
 * chose. `./runtime/index.ts`, `./runtime/index.js` and `./runtime/index.d.ts`
 * name one module; `./runtime/other.ts` never does.
 */
function moduleIdentity(specifier: string, directory: string): string {
  const path = specifier.startsWith(".") ? resolve(directory, specifier) : specifier;
  return path.replace(/\.(?:d\.)?[cm]?[jt]sx?$/, "");
}

/**
 * The runtime module the lowering phase itself imported into this module.
 *
 * `compileSemanticModel` prepends its header — a generation banner followed by
 * exactly one import declaration — ahead of the lowered body, so the leading
 * import under that banner is compiler-issued by construction: an authored
 * `.sm` that writes the same banner text still lands *after* the real header
 * and is therefore never the first statement.
 */
function compilerRuntimeModule(sourceFile: ts.SourceFile, code: string): string | undefined {
  const first = sourceFile.statements[0];
  if (!first || !ts.isImportDeclaration(first) || !ts.isStringLiteral(first.moduleSpecifier)) return undefined;
  const banner = code.slice(0, first.getStart(sourceFile)).trim();
  return GENERATED_HEADER_BANNER.test(banner) ? first.moduleSpecifier.text : undefined;
}

/**
 * Which module each local name in an emitted declaration was imported from,
 * and under which export name. `import { Result as R }` records `Result`, so a
 * rename keeps its provenance; `import { Other as Result }` records `Other`,
 * so a *re-spelling* loses it. Local declarations are absent by construction,
 * which is what keeps a user's own `Result` out of this pass.
 */
interface ImportedBinding {
  readonly module: string;
  readonly exportName: string;
}

function importedBindings(sourceFile: ts.SourceFile, directory: string): ReadonlyMap<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    const module = moduleIdentity(statement.moduleSpecifier.text, directory);
    if (clause.name) bindings.set(clause.name.text, { module, exportName: "default" });
    const named = clause.namedBindings;
    if (!named) continue;
    if (ts.isNamespaceImport(named)) bindings.set(named.name.text, { module, exportName: "*" });
    else for (const element of named.elements) {
      bindings.set(element.name.text, { module, exportName: (element.propertyName ?? element.name).text });
    }
  }
  return bindings;
}

/**
 * Whether a type name denotes the `Result` export of a `runtimeModules` entry.
 * The terminal spelling alone is never enough: an unqualified name must be an
 * import binding of that module's `Result`, and a qualified one must reach it
 * through a namespace import of that same module. `User.Result` declared in
 * the emitted file resolves to no import binding and is rejected.
 */
function isRuntimeChannelName(
  typeName: ts.EntityName,
  bindings: ReadonlyMap<string, ImportedBinding>,
  runtimeModules: ReadonlySet<string>,
): boolean {
  if (ts.isIdentifier(typeName)) {
    const binding = bindings.get(typeName.text);
    return binding !== undefined && runtimeModules.has(binding.module) &&
      binding.exportName === RUNTIME_CHANNEL_EXPORT;
  }
  if (!ts.isIdentifier(typeName.left) || typeName.right.text !== RUNTIME_CHANNEL_EXPORT) return false;
  const binding = bindings.get(typeName.left.text);
  return binding !== undefined && runtimeModules.has(binding.module) && binding.exportName === "*";
}

/**
 * Whether a union of runtime `Result` references *is* the split the checker
 * infers from a lowered body, rather than a union an author wrote.
 *
 * A lowered body reaches its channel one side at a time — `__vsResultSuccess`
 * contributes `Result<A, never>`, `__vsResultFailure` contributes
 * `Result<never, E>` — so every member carries `never` in exactly one channel
 * and both channels are covered across the union. `Result<string, ParseError>
 * | Result<number, RangeError>` fails on the first clause: merging it would
 * publish a strict supertype that pairs `number` with `ParseError`, which the
 * implementation never handled. Anything failing this predicate ships byte for
 * byte as TypeScript wrote it.
 */
function isGeneratedChannelSplit(references: readonly ChannelTypeReference[]): boolean {
  if (references.length < 2) return false;
  const covered = new Set<number>();
  for (const reference of references) {
    if (reference.arguments.length !== 2) return false;
    const nevers = reference.arguments
      .map((argument, position) => (argument.kind === ts.SyntaxKind.NeverKeyword ? position : -1))
      .filter((position) => position >= 0);
    if (nevers.length !== 1) return false;
    covered.add(nevers[0]!);
  }
  return covered.size === 2;
}

function splitEffectVariableStatements(
  code: string,
  effects: Readonly<Record<string, FunctionRows>>,
  fileName: string,
): string {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statements: ts.Statement[] = [];
  let changed = false;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length < 2 ||
      !statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && Object.hasOwn(effects, declaration.name.text))) {
      statements.push(statement);
      continue;
    }
    changed = true;
    for (const declaration of statement.declarationList.declarations) {
      statements.push(ts.factory.createVariableStatement(
        statement.modifiers,
        ts.factory.createVariableDeclarationList([declaration], statement.declarationList.flags),
      ));
    }
  }
  return changed
    ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(
        ts.factory.updateSourceFile(sourceFile, statements),
      )
    : code;
}

interface ChannelResolution {
  readonly sourceFile: ts.SourceFile;
  readonly factory: ts.NodeFactory;
  readonly bindings: ReadonlyMap<string, ImportedBinding>;
  readonly directory: string;
  /** The seam the compiler wrote, plus any packaged path it resolves through. */
  readonly runtimeModules: ReadonlySet<string>;
}

function channelTypeReference(node: ts.TypeNode, scope: ChannelResolution): ChannelTypeReference | undefined {
  const { sourceFile, factory } = scope;
  if (ts.isTypeReferenceNode(node) && node.typeArguments &&
    isRuntimeChannelName(node.typeName, scope.bindings, scope.runtimeModules)) {
    return {
      head: `reference:${node.typeName.getText(sourceFile)}`,
      arguments: node.typeArguments,
      rebuild: (arguments_) => factory.updateTypeReferenceNode(node, node.typeName, factory.createNodeArray(arguments_)),
    };
  }
  // `import("<runtime>").Result<...>` carries its module inline, so provenance
  // is the resolved specifier rather than a file-local import binding.
  if (ts.isImportTypeNode(node) && node.qualifier && node.typeArguments && !node.isTypeOf &&
    ts.isIdentifier(node.qualifier) && node.qualifier.text === RUNTIME_CHANNEL_EXPORT &&
    ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) &&
    scope.runtimeModules.has(moduleIdentity(node.argument.literal.text, scope.directory))) {
    return {
      head: `import:${node.argument.getText(sourceFile)}:${node.qualifier.getText(sourceFile)}`,
      arguments: node.typeArguments,
      rebuild: (arguments_) => factory.updateImportTypeNode(
        node,
        node.argument,
        node.attributes,
        node.qualifier,
        factory.createNodeArray(arguments_),
        node.isTypeOf,
      ),
    };
  }
  return undefined;
}

/**
 * The type node holding a declaration's compiler-generated return channel.
 * Parameters, heritage clauses and member types are deliberately unreachable:
 * the union this pass collapses is produced by the checker from the runtime
 * `Result` a lowered body returns, so no other position can hold one.
 */
function channelRootType(statement: ts.Statement): ts.TypeNode | undefined {
  if (ts.isFunctionDeclaration(statement)) return statement.type;
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    return statement.declarationList.declarations[0]!.type;
  }
  return undefined;
}

/**
 * Collapse the channel union at `node`, descending only the wrapper chain a
 * generated return can sit under — `Promise<...>` for an async body, a
 * function type for a declaration typed as a lambda. Anything else stops the
 * walk, so an unrecognized shape is left exactly as the emitter wrote it.
 */
function normalizeChannelType(
  node: ts.TypeNode,
  scope: ChannelResolution,
  depth: number,
): ts.TypeNode | undefined {
  if (depth > CHANNEL_DEPTH_LIMIT) return undefined;
  const { factory } = scope;
  if (ts.isUnionTypeNode(node)) {
    const references = node.types.map((type) => channelTypeReference(type, scope));
    if (!references.every((reference): reference is ChannelTypeReference => reference !== undefined) ||
      references.some((reference) => reference.head !== references[0]!.head) ||
      !isGeneratedChannelSplit(references)) {
      return undefined;
    }
    return references[0]!.rebuild([
      combinedType(references.map((reference) => reference.arguments[0]!), scope.sourceFile, factory),
      combinedType(references.map((reference) => reference.arguments[1]!), scope.sourceFile, factory),
    ]);
  }
  if (ts.isParenthesizedTypeNode(node)) {
    const inner = normalizeChannelType(node.type, scope, depth + 1);
    return inner && factory.updateParenthesizedType(node, inner);
  }
  if (ts.isFunctionTypeNode(node)) {
    const inner = normalizeChannelType(node.type, scope, depth + 1);
    return inner && factory.updateFunctionTypeNode(node, node.typeParameters, node.parameters, inner);
  }
  if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1) {
    const inner = normalizeChannelType(node.typeArguments[0]!, scope, depth + 1);
    return inner &&
      factory.updateTypeReferenceNode(node, node.typeName, factory.createNodeArray([inner]));
  }
  if (ts.isImportTypeNode(node) && node.typeArguments?.length === 1) {
    const inner = normalizeChannelType(node.typeArguments[0]!, scope, depth + 1);
    return inner && factory.updateImportTypeNode(
      node,
      node.argument,
      node.attributes,
      node.qualifier,
      factory.createNodeArray([inner]),
      node.isTypeOf,
    );
  }
  return undefined;
}

function replaceChannelRoot(
  statement: ts.Statement,
  channel: ts.TypeNode,
  factory: ts.NodeFactory,
): ts.Statement {
  if (ts.isFunctionDeclaration(statement)) {
    return factory.updateFunctionDeclaration(
      statement,
      statement.modifiers,
      statement.asteriskToken,
      statement.name,
      statement.typeParameters,
      statement.parameters,
      channel,
      statement.body,
    );
  }
  const list = (statement as ts.VariableStatement).declarationList;
  const declaration = list.declarations[0]!;
  return factory.updateVariableStatement(
    statement as ts.VariableStatement,
    (statement as ts.VariableStatement).modifiers,
    factory.updateVariableDeclarationList(list, [factory.updateVariableDeclaration(
      declaration,
      declaration.name,
      declaration.exclamationToken,
      channel,
      declaration.initializer,
    )]),
  );
}

function combinedType(
  values: readonly ts.TypeNode[],
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
): ts.TypeNode {
  const nonNever = values.filter((value) => value.kind !== ts.SyntaxKind.NeverKeyword);
  const unique = new Map<string, ts.TypeNode>();
  for (const value of nonNever) unique.set(value.getText(sourceFile), value);
  const nodes = [...unique.values()];
  if (nodes.length === 0) return factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
  if (nodes.length === 1) return nodes[0]!;
  return factory.createUnionTypeNode(nodes);
}

/**
 * Collapse the compiler-generated `Result<A, never> | Result<never, E>` union a
 * lowered body infers, in the one position that can hold it.
 *
 * `runtimeModules` are the specifiers the lowering phase emitted its runtime
 * import from — the package seam it wrote, plus any path that seam is resolved
 * through, since the declaration emitter may name either. Without them nothing
 * is normalized: the terminal spelling `Result` is not evidence of ownership,
 * so a declaration whose provenance is unknown ships exactly as TypeScript
 * wrote it.
 */
export function normalizeDeclarationEffectChannels(
  code: string,
  effects: Readonly<Record<string, FunctionRows>>,
  fileName = "module.d.mts",
  runtimeModules?: string | readonly string[],
): string {
  code = splitEffectVariableStatements(code, effects, fileName);
  const specifiers = runtimeModules === undefined
    ? []
    : typeof runtimeModules === "string" ? [runtimeModules] : [...runtimeModules];
  if (specifiers.length === 0) return code;
  if (specifiers.some((specifier) => typeof specifier !== "string" || specifier.length === 0)) {
    throw new TypeError("runtimeModules must be module specifiers");
  }
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const directory = dirname(resolve(fileName));
  const scopeParts = {
    sourceFile,
    bindings: importedBindings(sourceFile, directory),
    directory,
    runtimeModules: new Set(specifiers.map((specifier) => moduleIdentity(specifier, directory))),
  };
  let changed = false;
  const transformed = ts.transform(sourceFile, [(context) => (file) =>
    context.factory.updateSourceFile(file, file.statements.map((statement) => {
      const name = statementDeclarationName(statement);
      if (!name || !Object.hasOwn(effects, name) || effects[name]!.failures.length === 0) return statement;
      const root = channelRootType(statement);
      if (!root) return statement;
      const channel = normalizeChannelType(root, { ...scopeParts, factory: context.factory }, 0);
      if (!channel) return statement;
      changed = true;
      return replaceChannelRoot(statement, channel, context.factory);
    }))]);
  const output = changed
    ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0] as ts.SourceFile)
    : code;
  transformed.dispose();
  return output;
}

/**
 * Attach unstable, versioned compiler metadata without changing the TypeScript
 * callable type. A future phantom-type encoding can replace this tag after its
 * generic/overload behavior is specified.
 */
export function annotateDeclarationEffects(
  code: string,
  effects: Readonly<Record<string, FunctionRows>>,
  fileName = "module.d.mts",
): string {
  code = splitEffectVariableStatements(code, effects, fileName);
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const insertions: Array<{ readonly start: number; readonly text: string }> = [];
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    const name = statementDeclarationName(statement);
    if (!name || !Object.hasOwn(effects, name)) continue;
    if (ts.getJSDocTags(statement).some((tag) => tag.tagName.text === DECLARATION_EFFECT_TAG)) {
      throw new TypeError(`declaration '${name}' already contains @${DECLARATION_EFFECT_TAG}`);
    }
    const row = effects[name]!;
    const failures = canonicalNames(row.failures, `${name}.failures`);
    const requirements = canonicalNames(row.requirements, `${name}.requirements`);
    const metadata = JSON.stringify({
      version: DECLARATION_EFFECT_VERSION,
      failures,
      requirements,
    });
    insertions.push({ start: statement.getStart(sourceFile), text: `/** @${DECLARATION_EFFECT_TAG} ${metadata} */\n` });
  }
  let output = code;
  for (const insertion of insertions.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, insertion.start)}${insertion.text}${output.slice(insertion.start)}`;
  }
  return output;
}

/** Strictly decode compiler-owned effect tags for future declaration consumers. */
export function readDeclarationEffects(
  code: string,
  fileName = "module.d.mts",
): Readonly<Record<string, FunctionRows>> {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rows: Record<string, FunctionRows> = Object.create(null);
  for (const statement of sourceFile.statements) {
    const tags = ts.getJSDocTags(statement).filter((tag) => tag.tagName.text === DECLARATION_EFFECT_TAG);
    if (tags.length === 0) continue;
    const name = statementDeclarationName(statement);
    if (!hasExportModifier(statement) || !name || tags.length !== 1 || Object.hasOwn(rows, name)) {
      throw new TypeError(`invalid @${DECLARATION_EFFECT_TAG} declaration metadata`);
    }
    const comment = tags[0]!.comment;
    if (typeof comment !== "string" || comment.length > 65_536) {
      throw new TypeError(`@${DECLARATION_EFFECT_TAG} metadata must be bounded JSON text`);
    }
    const parsed: unknown = JSON.parse(comment);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new TypeError(`@${DECLARATION_EFFECT_TAG} metadata must be an object`);
    }
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort(compareText).join(",") !== "failures,requirements,version" ||
      record.version !== DECLARATION_EFFECT_VERSION) {
      throw new TypeError(`@${DECLARATION_EFFECT_TAG} metadata has an unsupported envelope`);
    }
    const failures = exactSortedNames(record.failures, `${name}.failures`);
    const requirements = exactSortedNames(record.requirements, `${name}.requirements`);
    const canonical = JSON.stringify({ version: DECLARATION_EFFECT_VERSION, failures, requirements });
    if (comment !== canonical) {
      throw new TypeError(`@${DECLARATION_EFFECT_TAG} metadata must use its canonical encoding`);
    }
    rows[name] = Object.freeze({ failures, requirements });
  }
  return Object.freeze(rows);
}

/**
 * Emit declarations for already-lowered modules through one stock TypeScript
 * Program. Inputs and outputs are virtual; callers decide whether to write.
 */
export function emitProjectDeclarations(
  sources: readonly DeclarationSource[],
  resolution?: EmittedModuleResolutionOptions,
): DeclarationEmitResult {
  if (sources.length === 0) return { outputs: [], diagnostics: [], ok: true };
  // Deliberately WITHOUT the mandatory table compiler-options.ts spreads into
  // the checking programs. This one emits `.d.ts` from a module set that has
  // already passed `checkEmittedProject`, which does carry that table — see the
  // `options.declaration && no errors` guard in src/cli.ts. Re-stating the
  // obligation here would re-run a gate that already ran, over a program this
  // one does not scope to its own files, so a resolved import would be charged
  // for rules compatibility.mdx §Configuration exempts it from.
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: true,
    allowImportingTsExtensions: true,
    declaration: true,
    emitDeclarationOnly: true,
    noEmitOnError: true,
    skipLibCheck: true,
    strict: true,
  };
  const sourceByName = new Map<string, { code: string; sourceFile: ts.SourceFile }>();
  const expectedOutputs = new Set<string>();
  const effectsByOutput = new Map<string, Readonly<Record<string, FunctionRows>>>();
  const runtimeByOutput = new Map<string, readonly string[]>();
  const overrides = resolution?.moduleOverrides;
  for (const source of sources) {
    const fileName = resolve(source.fileName);
    if (sourceByName.has(fileName)) throw new TypeError(`duplicate declaration source '${fileName}'`);
    const outputName = resolve(declarationOutputName(fileName));
    if (expectedOutputs.has(outputName)) throw new TypeError(`duplicate declaration output '${outputName}'`);
    expectedOutputs.add(outputName);
    const sourceFile = ts.createSourceFile(fileName, source.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    sourceByName.set(fileName, { code: source.code, sourceFile });
    if (source.effects) effectsByOutput.set(outputName, source.effects);
    // Stated provenance wins; otherwise recover it from the header the
    // lowering phase wrote, which is the module its own `Result` came from.
    // A packaged seam is also accepted under the path it resolves through,
    // because the declaration emitter names the resolved file for a
    // synthesized `import(...)` type while keeping the seam for a written one.
    const runtimeModule = source.runtimeModule ?? compilerRuntimeModule(sourceFile, source.code);
    if (runtimeModule !== undefined) {
      runtimeByOutput.set(outputName, overrides && Object.hasOwn(overrides, runtimeModule)
        ? [runtimeModule, overrides[runtimeModule]!]
        : [runtimeModule]);
    }
  }

  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const authored = sourceByName.get(resolve(name));
    return authored?.sourceFile ?? getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => sourceByName.has(resolve(name)) || fileExists(name);
  host.readFile = (name) => sourceByName.get(resolve(name))?.code ?? readFile(name);
  // The same resolver the checker uses, for the same reason: a declaration
  // batch must be produced from the bytes that were emitted, never from a
  // rewritten copy of them.
  host.resolveModuleNames = createEmittedModuleResolver(
    (fileName) => sourceByName.has(fileName),
    options,
    host,
    resolution?.moduleOverrides,
  );

  const emitted = new Map<string, string>();
  host.writeFile = (fileName, code) => {
    const output = resolve(fileName);
    // Imported implementation dependencies belong to their package, not this
    // declaration batch. TypeScript can otherwise emit them when an API caller
    // points a module import directly at a `.ts` file.
    if (!expectedOutputs.has(output)) return;
    if (emitted.has(output)) throw new TypeError(`duplicate declaration output '${output}'`);
    emitted.set(output, code);
  };
  const rootNames = [...sourceByName.keys()].sort(compareText);
  const program = ts.createProgram({ rootNames, options, host });
  const preEmit = ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  const result = preEmit.length === 0 ? program.emit(undefined, host.writeFile, undefined, true) : undefined;
  const diagnostics = [
    ...preEmit,
    ...(result?.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
  ];
  const outputs = [...emitted].sort(([left], [right]) => compareText(left, right))
    .map(([fileName, code]) => ({
      fileName,
      code: effectsByOutput.has(fileName)
        ? annotateDeclarationEffects(
            normalizeDeclarationEffectChannels(
              code,
              effectsByOutput.get(fileName)!,
              fileName,
              runtimeByOutput.get(fileName),
            ),
            effectsByOutput.get(fileName)!,
            fileName,
          )
        : code,
    }));
  return {
    outputs,
    diagnostics,
    ok: diagnostics.length === 0 && result?.emitSkipped !== true && outputs.length === expectedOutputs.size,
  };
}

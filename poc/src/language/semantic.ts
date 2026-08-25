import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "typescript-js";
import type {
  Analysis,
  AnalyzeOptions,
  AnalyzeProjectOptions,
  Diagnostic,
  ErrorDeclaration,
  FunctionChannel,
  FunctionDeclaration,
  FunctionRows,
  ProjectAnalysis,
  ProjectDiagnostic,
  ProjectFileAnalysis,
  ProjectSource,
} from "./model.ts";
import {
  recoverSmithersSyntax,
  scanTokens as scanRecoveryTokens,
  tokenEndsExpression,
  type RecoveredSource,
} from "./recover.ts";
import { isCompilerIssuedRuntimeSource } from "./runtime-source-authority.ts";

const PRELUDE_NAME = "__smithers_frontend_prelude__.d.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Checker-only declarations. They describe the source language surface without
 * making the POC runtime importable from an uncompiled `.sm` module.
 */
const PRELUDE = String.raw`
interface Result<A, E extends Error> {
  readonly __smithersResult: { readonly success: A; readonly error: E }
  isOk(): boolean
  isError(): boolean
  match<B>(handlers: { ok(value: A): B; error(error: E): B }): B
  map<B>(fn: (value: A) => B): Result<B, E>
  mapError<F extends Error>(fn: (error: E) => F): Result<A, F>
  andThen<B, F extends Error>(fn: (value: A) => Result<B, F>): Result<B, E | F>
  recover<B>(fn: (error: E) => B): Result<A | B, never>
  tap(fn: (value: A) => unknown): Result<A, E>
  tapError(fn: (error: E) => unknown): Result<A, E>
  unwrapOr(value: A): A
  expect(message: string): A
}
declare const Result: {
  // The failure channel is the union of the collected Results' own failures.
  // Widening it to \`Error\` made an ordinary \`Result.all([...])!\` propagate a
  // failure named \`Error\` into its caller's contract, which then reported
  // SMITHERS1104 for a failure the program cannot actually produce.
  // specification/failures.mdx: transformations "MUST preserve or correctly
  // combine the Result error type"; the runtime declaration in
  // poc/src/runtime/result.ts already combines it precisely.
  all<const T extends readonly Result<unknown, Error>[]>(values: T): Result<unknown, T[number]["__smithersResult"]["error"]>
  try<A>(body: () => A): Result<A, Panic>
  try<A, E extends Error>(body: () => A, mapper: (cause: unknown) => E): Result<A, E | Panic>
  tryPromise<A>(body: () => PromiseLike<A>): Promise<Result<A, Panic>>
  tryPromise<A, E extends Error>(body: () => PromiseLike<A>, mapper: (cause: unknown) => E): Promise<Result<A, E | Panic>>
}

declare class Panic extends Error { readonly cause?: unknown }
declare namespace Reflect { function panic(cause?: unknown): never }

interface Error {
  is<T extends Error>(kind: abstract new (...args: never[]) => T): this is T
  matches<T extends Error>(kind: abstract new (...args: never[]) => T): boolean
  match<B>(handlers: Record<string, (error: Error) => B>): B
  matchPartial<B, F>(handlers: Record<string, (error: Error) => B>, fallback: (error: Error) => F): B | F
  rootCause(): Error
}

declare module "smthrs/context" {
  export abstract class Context {
    static context<C extends abstract new (...args: never[]) => Context>(this: C): InstanceType<C>
  }
}

declare module "smthrs/provider" {
  import type { Context } from "smthrs/context"
  export interface Layer<P> {
    readonly __smithersLayer: { readonly provides: P }
  }
  export const Layer: {
    succeed<C extends abstract new (...args: never[]) => Context>(capability: C, implementation: InstanceType<C>): Layer<C>
    merge<const L extends readonly Layer<unknown>[]>(...layers: L): Layer<L[number] extends Layer<infer P> ? P : never>
    provide<L extends Layer<unknown>, A>(layer: L, body: () => A): A
  }
}

declare module "smithers:exceptions" {
  export { Panic }
  export function panic(cause?: unknown): never
}

`;

export interface TypeShape {
  readonly channel: FunctionChannel;
  readonly async: boolean;
  readonly failures: ReadonlySet<string>;
  readonly successType?: ts.Type;
}

export interface ForeignPolicy {
  readonly kind: "panic" | "never" | "declared";
  readonly errorName?: string;
  /** In-scope runtime constructor selected by checker symbol identity. */
  readonly errorValuePath?: readonly string[];
  readonly async: boolean;
  /** False when the boundary is known but expression-order-safe emit is deferred. */
  readonly lowerable: boolean;
}

export interface CallEdge {
  readonly node: ts.CallExpression;
  readonly callee?: SemanticFunction;
  readonly foreign?: ForeignPolicy;
  readonly panicExit?: boolean;
  readonly propagatesFailure: boolean;
  /**
   * The call happens directly inside the inline callback of an authored
   * prelude `Result.try`/`Result.tryPromise` boundary. The authored boundary
   * already owns the throw scope, so the call is neither re-wrapped nor
   * treated as an already-checked Result value.
   */
  readonly authoredBoundary?: boolean;
  /**
   * Checker-instantiated failure row for a callee whose declared row is a
   * polymorphic template (its `Result` error mentions the callee's own type
   * parameters, or a deferred type operation over them). It wholly replaces
   * `callee.failures` at this call site; the template is never substituted
   * member-by-member, so a type parameter that shadows an Error class name
   * cannot silently rewrite a concrete row member.
   */
  readonly instantiatedFailures?: ReadonlySet<string>;
}

export interface ProvideEdge {
  readonly node: ts.CallExpression;
  readonly callback?: SemanticFunction;
  readonly callbackReference?: SemanticFunction;
  readonly provided: ReadonlySet<string>;
  readonly complete: boolean;
}

export interface SemanticFunction {
  readonly node: ts.FunctionLikeDeclaration;
  readonly name: string;
  readonly publicName?: string;
  readonly exported: boolean;
  readonly async: boolean;
  readonly explicitReturn: boolean;
  readonly declaredShape: TypeShape;
  readonly directFailures: Set<string>;
  readonly bodyFailures: Set<string>;
  readonly failures: Set<string>;
  readonly directRequirements: Set<string>;
  readonly requirements: Set<string>;
  readonly calls: CallEdge[];
  readonly provides: ProvideEdge[];
  /** `X.expect(...)` call sites; the panic channel is charged during row inference. */
  readonly expectCalls: ts.CallExpression[];
  /** Inline callbacks of authored `Result.try`/`tryPromise` boundary calls in this body. */
  readonly boundaryCallbacks: SemanticFunction[];
  hasResultPropagation: boolean;
}

export interface SemanticModel {
  /** The authored `.sm` text. */
  readonly source: string;
  /** Pre-parse expression recovery relating authored and parsed text. */
  readonly recovery: RecoveredSource;
  readonly fileName: string;
  /** Parsed from RecoveredSource.parseSource; positions are derived offsets. */
  readonly sourceFile: ts.SourceFile;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly functions: readonly SemanticFunction[];
  readonly functionByNode: ReadonlyMap<ts.Node, SemanticFunction>;
  readonly callEdges: ReadonlyMap<ts.CallExpression, CallEdge>;
  readonly diagnostics: readonly Diagnostic[];
  readonly errors: readonly ErrorDeclaration[];
  readonly rows: Readonly<Record<string, FunctionRows>>;
  readonly publicFunctions: readonly FunctionDeclaration[];
}

export interface PendingDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly start: number;
}

export function buildSemanticModel(source: string, options: AnalyzeOptions = {}): SemanticModel {
  const recovery = recoverSmithersSyntax(source);
  const environment = createProgram(recovery.parseSource, options.fileName);
  const { sourceFile, checker } = environment;
  const pending: PendingDiagnostic[] = [];
  checkRemovedAndUnsupportedSyntax(recovery.parseSource, sourceFile, checker, recovery, pending);

  const functions = collectFunctions(sourceFile, checker);
  const functionByNode = new Map<ts.Node, SemanticFunction>();
  for (const fn of functions) functionByNode.set(fn.node, fn);

  const callEdges = new Map<ts.CallExpression, CallEdge>();
  const layerBindings = collectLayerBindings(sourceFile, checker);
  for (const fn of functions) {
    collectFacts(fn, checker, sourceFile, functions, functionByNode, layerBindings, pending, callEdges);
  }

  checkForeignValueBoundaries(sourceFile, checker, pending, callEdges, functionByNode);
  inferRows(functions, checker, callEdges);
  checkFunctionContracts(functions, checker, pending);
  checkLayerSatisfaction(sourceFile, functions, functionByNode, layerBindings, checker, pending);
  checkCallbackOwnership(sourceFile, functions, functionByNode, callEdges, checker, pending);
  checkTopLevelForeignBoundaries(sourceFile, checker, pending, callEdges, functions, functionByNode);
  checkJavaScriptCatchBoundaries(sourceFile, checker, callEdges, pending);
  checkMustConsume(sourceFile, functions, functionByNode, callEdges, checker, pending);
  checkAuthoredApis(sourceFile, checker, pending);
  checkErrorMatches(sourceFile, checker, pending);
  checkDuplicateErrorNames(sourceFile, checker, pending);

  const diagnostics = finalizeDiagnostics(pending, recovery, sourceFile);

  const errors = collectErrorDeclarations(sourceFile, checker, recovery.parseSource)
    .map((error) => remapErrorDeclaration(error, recovery));
  const rows: Record<string, FunctionRows> = {};
  const publicFunctions: FunctionDeclaration[] = [];
  for (const fn of functions) {
    if (!fn.publicName) continue;
    rows[fn.publicName] = {
      failures: [...fn.failures].sort(),
      requirements: [...fn.requirements].sort(),
    };
    publicFunctions.push(publicFunctionDeclaration(fn, sourceFile, recovery));
  }

  return {
    source,
    recovery,
    fileName: environment.fileName,
    sourceFile,
    program: environment.program,
    checker,
    functions,
    functionByNode,
    callEdges,
    diagnostics,
    errors,
    rows,
    publicFunctions,
  };
}

interface ProjectEntry {
  readonly displayName: string;
  readonly absoluteName: string;
  readonly internalName: string;
  /** The parsed (recovery-derived) text; matches sourceFile positions. */
  readonly source: string;
  /** The authored `.sm` text. */
  readonly authoredSource: string;
  readonly recovery: RecoveredSource;
  readonly sourceFile: ts.SourceFile;
}

export interface SemanticProject {
  readonly analysis: ProjectAnalysis;
  readonly models: ReadonlyMap<string, SemanticModel>;
  readonly rootDir: string;
}

/** Internal whole-project pass shared by project analysis and lowering. */
export function buildSemanticProjectModels(
  inputs: readonly ProjectSource[],
  options: AnalyzeProjectOptions = {},
): SemanticProject {
  if (inputs.length === 0) {
    return { analysis: { files: {}, diagnostics: [] }, models: new Map(), rootDir: resolve(options.rootDir ?? process.cwd()) };
  }

  const environment = createProjectProgram(inputs, options);
  const { checker } = environment;
  // Nominal row identities must exist before any row member is minted.
  rowNamingByChecker.set(checker, buildRowNaming(environment.entries, checker));
  const pendingByFile = new Map<ts.SourceFile, PendingDiagnostic[]>();
  for (const entry of environment.entries) {
    const pending: PendingDiagnostic[] = [];
    pendingByFile.set(entry.sourceFile, pending);
    checkRemovedAndUnsupportedSyntax(entry.source, entry.sourceFile, checker, entry.recovery, pending);
  }

  const functions = environment.entries.flatMap((entry) => collectFunctions(entry.sourceFile, checker));
  const functionByNode = new Map<ts.Node, SemanticFunction>();
  for (const fn of functions) functionByNode.set(fn.node, fn);

  const callEdges = new Map<ts.CallExpression, CallEdge>();
  const layerBindings = new Map<ts.Symbol, ts.Expression>();
  for (const entry of environment.entries) {
    for (const [symbol, expression] of collectLayerBindings(entry.sourceFile, checker)) {
      layerBindings.set(symbol, expression);
    }
  }
  for (const fn of functions) {
    const sourceFile = fn.node.getSourceFile();
    collectFacts(
      fn,
      checker,
      sourceFile,
      functions,
      functionByNode,
      layerBindings,
      pendingByFile.get(sourceFile)!,
      callEdges,
    );
  }

  for (const entry of environment.entries) {
    checkForeignValueBoundaries(
      entry.sourceFile,
      checker,
      pendingByFile.get(entry.sourceFile)!,
      callEdges,
      functionByNode,
    );
  }
  inferRows(functions, checker, callEdges);
  for (const entry of environment.entries) {
    const pending = pendingByFile.get(entry.sourceFile)!;
    const fileFunctions = functions.filter((fn) => fn.node.getSourceFile() === entry.sourceFile);
    checkFunctionContracts(fileFunctions, checker, pending);
    checkLayerSatisfaction(entry.sourceFile, functions, functionByNode, layerBindings, checker, pending);
    checkCallbackOwnership(entry.sourceFile, functions, functionByNode, callEdges, checker, pending);
    checkTopLevelForeignBoundaries(
      entry.sourceFile,
      checker,
      pending,
      callEdges,
      functions,
      functionByNode,
    );
    checkJavaScriptCatchBoundaries(entry.sourceFile, checker, callEdges, pending);
    checkMustConsume(entry.sourceFile, functions, functionByNode, callEdges, checker, pending);
    checkAuthoredApis(entry.sourceFile, checker, pending);
    checkErrorMatches(entry.sourceFile, checker, pending);
    checkDuplicateErrorNames(entry.sourceFile, checker, pending);
  }
  checkProjectImports(environment, pendingByFile);
  checkDeferredProjectCalls(environment, functions, callEdges, pendingByFile);

  const files: Record<string, ProjectFileAnalysis> = {};
  const models = new Map<string, SemanticModel>();
  const allDiagnostics: ProjectDiagnostic[] = [];
  for (const entry of environment.entries) {
    const fileFunctions = functions.filter((fn) => fn.node.getSourceFile() === entry.sourceFile);
    const analysis = analysisForFile(
      entry.source,
      entry.recovery,
      entry.sourceFile,
      checker,
      fileFunctions,
      pendingByFile.get(entry.sourceFile)!,
    );
    files[entry.displayName] = { fileName: entry.displayName, ...analysis };
    models.set(entry.displayName, {
      source: entry.authoredSource,
      recovery: entry.recovery,
      fileName: entry.absoluteName,
      sourceFile: entry.sourceFile,
      program: environment.program,
      checker,
      functions: fileFunctions,
      functionByNode,
      callEdges,
      diagnostics: analysis.diagnostics,
      errors: analysis.errors,
      rows: analysis.rows,
      publicFunctions: analysis.functions,
    });
    for (const diagnostic of analysis.diagnostics) {
      allDiagnostics.push({ fileName: entry.displayName, ...diagnostic });
    }
  }
  allDiagnostics.sort((left, right) => compareText(left.fileName, right.fileName) ||
    left.start - right.start || compareText(left.code, right.code) || compareText(left.message, right.message));
  return {
    analysis: { files, diagnostics: allDiagnostics },
    models,
    rootDir: environment.rootDir,
  };
}

/** Internal whole-project pass used by analyzeProject. */
export function buildSemanticProject(
  inputs: readonly ProjectSource[],
  options: AnalyzeProjectOptions = {},
): ProjectAnalysis {
  return buildSemanticProjectModels(inputs, options).analysis;
}

interface ProjectEnvironment {
  readonly rootDir: string;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly entries: readonly ProjectEntry[];
  readonly entryByAbsoluteName: ReadonlyMap<string, ProjectEntry>;
  readonly entryByInternalName: ReadonlyMap<string, ProjectEntry>;
}

interface ProjectRuntimeEntry {
  readonly absoluteName: string;
  readonly internalName: string;
  readonly source: string;
  readonly resolutionAliases: readonly string[];
  readonly compilerIssued: boolean;
}

const trustedCompilerRuntimeSourceFiles = new WeakSet<ts.SourceFile>();

function createProjectProgram(
  inputs: readonly ProjectSource[],
  options: AnalyzeProjectOptions,
): ProjectEnvironment {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const staged: Array<Omit<ProjectEntry, "sourceFile">> = [];
  const seenDisplayNames = new Set<string>();
  const seenAbsoluteNames = new Set<string>();
  for (const input of inputs) {
    if (!input.fileName.endsWith(".sm")) {
      throw new TypeError(`project source '${input.fileName}' must end in .sm`);
    }
    if (seenDisplayNames.has(input.fileName)) {
      throw new TypeError(`duplicate project source name '${input.fileName}'`);
    }
    const absoluteName = resolve(rootDir, input.fileName);
    if (seenAbsoluteNames.has(absoluteName)) {
      throw new TypeError(`project source '${input.fileName}' resolves to a duplicate path`);
    }
    seenDisplayNames.add(input.fileName);
    seenAbsoluteNames.add(absoluteName);
    const recovery = recoverSmithersSyntax(input.source);
    staged.push({
      displayName: input.fileName,
      absoluteName,
      internalName: `${absoluteName}.ts`,
      source: recovery.parseSource,
      authoredSource: input.source,
      recovery,
    });
  }
  staged.sort((left, right) => compareText(left.displayName, right.displayName));

  const runtimeStaged: ProjectRuntimeEntry[] = [];
  const seenRuntimeNames = new Set<string>();
  for (const [index, input] of (options.additionalRuntimeSources ?? []).entries()) {
    if (
      input === null || typeof input !== "object" ||
      typeof input.sourceFileName !== "string" || input.sourceFileName.trim() === "" ||
      typeof input.source !== "string" ||
      (input.resolutionAliases !== undefined &&
        (!Array.isArray(input.resolutionAliases) ||
          !input.resolutionAliases.every((alias) => typeof alias === "string" && alias.trim() !== "")))
    ) {
      throw new TypeError(`additional runtime source ${index} has an invalid shape`);
    }
    const absoluteName = resolve(rootDir, input.sourceFileName);
    const relativeName = relative(rootDir, absoluteName);
    if (relativeName === "" || relativeName === ".." || relativeName.startsWith(`..${sep}`) || isAbsolute(relativeName)) {
      throw new TypeError(`additional runtime source '${input.sourceFileName}' must be beneath the project root`);
    }
    if (seenAbsoluteNames.has(absoluteName) || seenRuntimeNames.has(absoluteName)) {
      throw new TypeError(`additional runtime source '${input.sourceFileName}' resolves to a duplicate path`);
    }
    if (Buffer.byteLength(input.source, "utf8") > 2 * 1024 * 1024) {
      throw new TypeError(`additional runtime source '${input.sourceFileName}' exceeds 2097152 bytes`);
    }
    const aliases = [...new Set((input.resolutionAliases ?? []).map((alias) => resolve(rootDir, alias)))].sort(compareText);
    for (const alias of aliases) {
      const relativeAlias = relative(rootDir, alias);
      if (relativeAlias === "" || relativeAlias === ".." || relativeAlias.startsWith(`..${sep}`) || isAbsolute(relativeAlias)) {
        throw new TypeError(`additional runtime alias '${alias}' must be beneath the project root`);
      }
      if (seenAbsoluteNames.has(alias) || seenRuntimeNames.has(alias) || alias === absoluteName) {
        throw new TypeError(`additional runtime alias '${alias}' resolves to a duplicate path`);
      }
    }
    seenRuntimeNames.add(absoluteName);
    for (const alias of aliases) seenRuntimeNames.add(alias);
    runtimeStaged.push({
      absoluteName,
      internalName: `${absoluteName}.__smithers_generated__.ts`,
      source: input.source,
      resolutionAliases: aliases,
      compilerIssued: isCompilerIssuedRuntimeSource(input),
    });
  }
  runtimeStaged.sort((left, right) => compareText(left.absoluteName, right.absoluteName));

  const stagedByAbsoluteName = new Map(staged.map((entry) => [entry.absoluteName, entry]));
  const stagedByInternalName = new Map(staged.map((entry) => [entry.internalName, entry]));
  const runtimeByAbsoluteName = new Map(runtimeStaged.map((entry) => [entry.absoluteName, entry]));
  const runtimeByInternalName = new Map(runtimeStaged.map((entry) => [entry.internalName, entry]));
  const resolvableByAbsoluteName = new Map<string, { readonly absoluteName: string; readonly internalName: string }>([
    ...staged.map((entry) => [entry.absoluteName, entry] as const),
    ...runtimeStaged.map((entry) => [entry.absoluteName, entry] as const),
    ...runtimeStaged.flatMap((entry) => entry.resolutionAliases.map((alias) => [alias, entry] as const)),
  ]);
  const preludeName = resolve(rootDir, PRELUDE_NAME);
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.Preserve,
    allowImportingTsExtensions: true,
  };
  const sourceFiles = new Map(staged.map((entry) => [
    entry.internalName,
    ts.createSourceFile(entry.internalName, entry.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  ]));
  for (const entry of runtimeStaged) {
    const sourceFile = ts.createSourceFile(
      entry.internalName,
      entry.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    sourceFiles.set(entry.internalName, sourceFile);
    if (entry.compilerIssued) trustedCompilerRuntimeSourceFiles.add(sourceFile);
  }
  const preludeFile = ts.createSourceFile(preludeName, PRELUDE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const resolved = resolve(name);
    if (resolved === preludeName) return preludeFile;
    const authored = sourceFiles.get(resolved);
    return authored ?? originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => {
    const resolved = resolve(name);
    return resolved === preludeName || sourceFiles.has(resolved) || originalFileExists(name);
  };
  host.readFile = (name) => {
    const resolved = resolve(name);
    if (resolved === preludeName) return PRELUDE;
    const authored = stagedByInternalName.get(resolved);
    const generated = runtimeByInternalName.get(resolved);
    return authored?.source ?? generated?.source ?? originalReadFile(name);
  };
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    const containing = stagedByInternalName.get(resolve(containingFile)) ??
      runtimeByInternalName.get(resolve(containingFile));
    const target = containing
      ? resolveProjectSpecifier(containing.absoluteName, moduleName, resolvableByAbsoluteName)
      : undefined;
    if (target) {
      return {
        resolvedFileName: target.internalName,
        extension: ts.Extension.Ts,
        isExternalLibraryImport: false,
      };
    }
    return ts.resolveModuleName(moduleName, containingFile, compilerOptions, host).resolvedModule;
  });

  const program = ts.createProgram({
    rootNames: [
      ...staged.map((entry) => entry.internalName),
      ...runtimeStaged.map((entry) => entry.internalName),
      preludeName,
    ],
    options: compilerOptions,
    host,
  });
  const entries: ProjectEntry[] = staged.map((entry) => ({
    ...entry,
    sourceFile: program.getSourceFile(entry.internalName) ?? sourceFiles.get(entry.internalName)!,
  }));
  const entryByAbsoluteName = new Map(entries.map((entry) => [entry.absoluteName, entry]));
  const entryByInternalName = new Map(entries.map((entry) => [entry.internalName, entry]));
  return { rootDir, program, checker: program.getTypeChecker(), entries, entryByAbsoluteName, entryByInternalName };
}

function resolveProjectSpecifier<T extends { readonly absoluteName: string }>(
  containingAbsoluteName: string,
  specifier: string,
  entries: ReadonlyMap<string, T>,
): T | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const exact = resolve(dirname(containingAbsoluteName), specifier);
  const candidates = [exact];
  if (extname(exact) === "") candidates.push(`${exact}.sm`, resolve(exact, "index.sm"));
  if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.sm`);
  for (const candidate of candidates) {
    const entry = entries.get(candidate);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Map a derived (parse-source) offset to an authored offset, exactly where
 * provable and to the recovery anchor otherwise.
 */
function remapOffset(recovery: RecoveredSource, offset: number): number {
  if (!recovery.changed) return offset;
  return recovery.toAuthored(offset) ?? recovery.toAuthoredAnchor(offset);
}

/** Exclusive span ends stay exact when the final contained unit is exact. */
function remapEnd(recovery: RecoveredSource, end: number): number {
  if (!recovery.changed) return end;
  if (end <= 0) return 0;
  const last = recovery.toAuthored(end - 1);
  return last !== undefined ? last + 1 : recovery.toAuthoredAnchor(end);
}

function remapErrorDeclaration(error: ErrorDeclaration, recovery: RecoveredSource): ErrorDeclaration {
  if (!recovery.changed) return error;
  return { ...error, start: remapOffset(recovery, error.start), end: remapEnd(recovery, error.end) };
}

function publicFunctionDeclaration(
  fn: SemanticFunction,
  sourceFile: ts.SourceFile,
  recovery: RecoveredSource,
): FunctionDeclaration {
  const body = fn.node.body;
  return {
    name: fn.publicName!,
    exported: fn.exported,
    async: fn.async,
    channel: effectiveChannel(fn),
    explicitReturn: fn.explicitReturn,
    start: remapOffset(recovery, fn.node.getStart(sourceFile)),
    end: remapEnd(recovery, fn.node.end),
    bodyStart: remapOffset(recovery, body?.getStart(sourceFile) ?? fn.node.end),
    bodyEnd: remapEnd(recovery, body?.end ?? fn.node.end),
  };
}

/**
 * Deduplicate, remap to authored coordinates, and locate diagnostics. All
 * pending diagnostics carry derived offsets; recovery diagnostics already
 * carry authored offsets and join after remapping.
 */
function finalizeDiagnostics(
  pending: readonly PendingDiagnostic[],
  recovery: RecoveredSource,
  sourceFile: ts.SourceFile,
): Diagnostic[] {
  const located = recovery.changed
    ? (diagnostic: PendingDiagnostic): Diagnostic => {
        const start = remapOffset(recovery, diagnostic.start);
        return { ...diagnostic, start, ...lineAndColumnFromText(recovery.authoredSource, start) };
      }
    : (diagnostic: PendingDiagnostic): Diagnostic => ({ ...diagnostic, ...lineAndColumn(sourceFile, diagnostic.start) });
  const remapped: Diagnostic[] = pending.map(located);
  for (const diagnostic of recovery.diagnostics) {
    remapped.push({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      start: diagnostic.start,
      ...lineAndColumnFromText(recovery.authoredSource, diagnostic.start),
    });
  }
  const seenDiagnostics = new Set<string>();
  return remapped
    .filter((diagnostic) => {
      const key = `${diagnostic.code}:${diagnostic.start}:${diagnostic.message}`;
      if (seenDiagnostics.has(key)) return false;
      seenDiagnostics.add(key);
      return true;
    })
    .sort((left, right) => left.start - right.start || compareText(left.code, right.code) ||
      compareText(left.message, right.message));
}

function lineAndColumnFromText(text: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < bounded; index++) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) index += 1;
      line += 1;
      lineStart = index + 1;
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: bounded - lineStart + 1 };
}

function analysisForFile(
  parseSource: string,
  recovery: RecoveredSource,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  pending: readonly PendingDiagnostic[],
): Analysis {
  const diagnostics = finalizeDiagnostics(pending, recovery, sourceFile);
  const rows: Record<string, FunctionRows> = {};
  const publicFunctions: FunctionDeclaration[] = [];
  for (const fn of functions) {
    if (!fn.publicName) continue;
    rows[fn.publicName] = {
      failures: [...fn.failures].sort(),
      requirements: [...fn.requirements].sort(),
    };
    publicFunctions.push(publicFunctionDeclaration(fn, sourceFile, recovery));
  }
  return {
    errors: collectErrorDeclarations(sourceFile, checker, parseSource)
      .map((error) => remapErrorDeclaration(error, recovery)),
    functions: publicFunctions,
    rows,
    diagnostics,
  };
}

function checkProjectImports(
  environment: ProjectEnvironment,
  pendingByFile: ReadonlyMap<ts.SourceFile, PendingDiagnostic[]>,
): void {
  const { checker } = environment;
  // A binding is valid when the target module declares it, or when the target
  // re-exports it from somewhere else. The second case is how a generated
  // asset module reaches an authored consumer:
  // `export { default as config } from "./a.json" with { type: "json" }`
  // resolves to a declaration in the generated module, not in the `.sm`
  // module that re-exports it.
  const exportsByModule = new Map<ts.SourceFile, ReadonlySet<ts.Symbol>>();
  const exportedSymbolsOf = (sourceFile: ts.SourceFile): ReadonlySet<ts.Symbol> => {
    const cached = exportsByModule.get(sourceFile);
    if (cached) return cached;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    const symbols = new Set(
      (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [])
        .map((exported) => unalias(exported, checker))
        .filter((exported): exported is ts.Symbol => exported !== undefined),
    );
    exportsByModule.set(sourceFile, symbols);
    return symbols;
  };
  for (const entry of environment.entries) {
    const diagnostics = pendingByFile.get(entry.sourceFile)!;
    for (const statement of entry.sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const target = resolveProjectSpecifier(entry.absoluteName, specifier, environment.entryByAbsoluteName);
      if (!target) {
        if (specifier.startsWith(".") && specifier.endsWith(".sm")) {
          diagnostics.push(at(
            statement.moduleSpecifier,
            entry.sourceFile,
            "SMITHERS1801",
            `relative Smithers module '${specifier}' is not present in the analyzeProject source set`,
          ));
        }
        continue;
      }
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const importedBindings: ts.Identifier[] = [];
      if (clause.name) importedBindings.push(clause.name);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly) importedBindings.push(element.name);
        }
      }
      const reExported = exportedSymbolsOf(target.sourceFile);
      for (const binding of importedBindings) {
        const resolved = unalias(checker.getSymbolAtLocation(binding), checker);
        const belongsToTarget = resolved !== undefined && (
          resolved.declarations?.some((declaration) => declaration.getSourceFile() === target.sourceFile) ||
          reExported.has(resolved)
        );
        if (!belongsToTarget) {
          diagnostics.push(at(
            binding,
            entry.sourceFile,
            "SMITHERS1804",
            `import '${binding.text}' does not resolve to an exported value in '${target.displayName}'`,
          ));
        }
      }
    }
  }
}

function checkDeferredProjectCalls(
  environment: ProjectEnvironment,
  functions: readonly SemanticFunction[],
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  pendingByFile: ReadonlyMap<ts.SourceFile, PendingDiagnostic[]>,
): void {
  const { checker } = environment;
  const functionBySymbol = new Map<ts.Symbol, SemanticFunction>();
  for (const fn of functions) {
    const symbol = functionSymbol(fn.node, checker);
    if (symbol) functionBySymbol.set(symbol, fn);
  }

  for (const entry of environment.entries) {
    const diagnostics = pendingByFile.get(entry.sourceFile)!;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !isInTypePosition(node) && !isProjectImportBinding(node)) {
        const symbol = unalias(checker.getSymbolAtLocation(node), checker);
        const target = symbol && functionBySymbol.get(symbol);
        if (target && target.node.getSourceFile() !== entry.sourceFile &&
          !isSupportedProjectCallReference(node, target, callEdges)) {
          diagnostics.push(at(
            node,
            entry.sourceFile,
            "SMITHERS1802",
            `cross-module function '${target.name}' escapes direct static call analysis; wrap the higher-order use in an explicitly checked local function`,
          ));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(entry.sourceFile);
  }
}

/** Type shapes whose members are only known once type arguments are supplied. */
const DEFERRED_TYPE_FLAGS = ts.TypeFlags.TypeParameter |
  ts.TypeFlags.Conditional |
  ts.TypeFlags.IndexedAccess |
  ts.TypeFlags.Substitution;

/**
 * The unresolved constituents of a row type, named for diagnostics. An empty
 * result means every constituent is a concrete nominal type, so the row can be
 * serialized as ordinary member names.
 */
function deferredRowConstituents(type: ts.Type, checker: ts.TypeChecker): readonly string[] {
  const names = new Set<string>();
  const seen = new Set<ts.Type>();
  const inspect = (current: ts.Type): void => {
    if (seen.has(current)) return;
    seen.add(current);
    if ((current.flags & DEFERRED_TYPE_FLAGS) !== 0) {
      names.add(checker.typeToString(current));
      return;
    }
    if (current.isUnionOrIntersection()) {
      for (const part of current.types) inspect(part);
      return;
    }
    for (const argument of typeArguments(current, checker)) inspect(argument);
  };
  inspect(type);
  return [...names].sort(compareText);
}

/** The declared `Result` error type of a function, after unwrapping `Promise`. */
function declaredFailureRowType(
  signature: ts.Signature | undefined,
  checker: ts.TypeChecker,
): ts.Type | undefined {
  if (!signature) return undefined;
  let returnType = checker.getReturnTypeOfSignature(signature);
  returnType = promisedType(returnType, checker) ?? returnType;
  if (nominalTypeName(returnType) !== "Result") return undefined;
  return typeArguments(returnType, checker)[1];
}

/**
 * A generic success value does not make a concrete Error/Context row
 * polymorphic. Only a declared `Result` error that mentions the declaration's
 * own type parameters (directly or through a deferred type operation) is a
 * polymorphic row template that each call site must instantiate.
 */
function genericRowTemplate(fn: SemanticFunction, checker: ts.TypeChecker): boolean {
  if (!fn.node.typeParameters?.length) return false;
  const signature = checker.getSignatureFromDeclaration(fn.node);
  if (!signature) return true;
  const error = declaredFailureRowType(signature, checker);
  // A generic declaration whose row is not a spelled `Result` error has no
  // template to instantiate; its row is whatever its body infers.
  if (!error) return false;
  return deferredRowConstituents(error, checker).length > 0;
}

type RowInstantiation =
  | { readonly ok: true; readonly failures: ReadonlySet<string> }
  | { readonly ok: false; readonly unresolved: readonly string[] };

/**
 * Instantiate a polymorphic failure-row template at one checker-resolved
 * direct static call. The checker has already substituted the call's explicit
 * or inferred type arguments into the resolved signature, so the instantiated
 * error type is read straight back out of it. Anything still deferred there
 * (the caller forwarding its own type parameter, an unresolvable conditional)
 * fails closed instead of contributing an approximate row.
 */
function instantiateFailureRow(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): RowInstantiation {
  const signature = checker.getResolvedSignature(call);
  if (!signature) return { ok: false, unresolved: ["the call signature"] };
  const error = declaredFailureRowType(signature, checker);
  if (!error) return { ok: false, unresolved: ["the instantiated Result error"] };
  const unresolved = deferredRowConstituents(error, checker);
  if (unresolved.length > 0) return { ok: false, unresolved };
  return { ok: true, failures: errorNames(error, checker) };
}

/** A type's own nominal name plus every base class name above it. */
function nominalAncestryNames(type: ts.Type, checker: ts.TypeChecker, seen = new Set<ts.Type>()): Set<string> {
  const names = new Set<string>();
  if (seen.has(type)) return names;
  seen.add(type);
  for (const name of errorNames(type, checker)) names.add(name);
  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    for (const base of checker.getBaseTypes(type as ts.InterfaceType) ?? []) {
      for (const name of nominalAncestryNames(base, checker, seen)) names.add(name);
    }
  }
  return names;
}

function typeConstituents(type: ts.Type): readonly ts.Type[] {
  return type.isUnion() ? type.types : [type];
}

/**
 * An instantiated row is only as nominal as the checker's assignability, and
 * two authored `class X extends Error {}` declarations are structurally the
 * same type. So a callback argument that carries its own explicit Result
 * contract is additionally required to be nominally covered by the row the
 * site instantiated: without this, an explicit type argument could name a
 * sibling Error and publish a row the callback can never produce.
 *
 * Callbacks without an explicit Result contract are already rejected by the
 * inferred-fallible callback rule, so they need no second gate here.
 */
function uncoveredCallbackRowNames(
  call: ts.CallExpression,
  row: ReadonlySet<string>,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): readonly string[] {
  const uncovered = new Set<string>();
  for (const argument of call.arguments) {
    const callback = resolveFunctionReference(argument, checker, functions, functionByNode);
    if (!callback?.explicitReturn || !callback.declaredShape.channel.startsWith("result")) continue;
    const declared = declaredFailureRowType(checker.getSignatureFromDeclaration(callback.node), checker);
    if (!declared) continue;
    for (const part of typeConstituents(declared)) {
      if (deferredRowConstituents(part, checker).length > 0) continue;
      const ancestry = nominalAncestryNames(part, checker);
      if (![...ancestry].some((name) => row.has(name))) {
        for (const name of errorNames(part, checker)) uncovered.add(name);
      }
    }
  }
  return [...uncovered].sort(compareText);
}

function isProjectImportBinding(node: ts.Identifier): boolean {
  const parent = node.parent;
  return ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent);
}

function isSupportedProjectCallReference(
  node: ts.Identifier,
  target: SemanticFunction,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  let expression: ts.Expression = node;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) expression = node.parent;
  const parent = expression.parent;
  return ts.isCallExpression(parent) && parent.expression === expression && callEdges.get(parent)?.callee === target;
}

function checkTopLevelForeignBoundaries(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  callEdges?: ReadonlyMap<ts.CallExpression, CallEdge>,
  functions: readonly SemanticFunction[] = [],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction> = new Map(),
): void {
  const visit = (node: ts.Node): void => {
    if (node !== sourceFile && isSupportedFunctionLike(node)) return;
    // Static blocks are rejected wholesale (SMITHERS1107); avoid duplicate reports.
    if (ts.isClassStaticBlockDeclaration(node)) return;
    if (ts.isThrowStatement(node)) {
      diagnostics.push(at(node, sourceFile, "SMITHERS1511", "a top-level throw cannot be represented as a checked Result; move it into a checked Result-returning function and consume that Result"));
    }
    if (ts.isCallExpression(node)) {
      if (callEdges && isResultExpectCall(node, checker, callEdges)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1505", "top-level Result.expect() panics on the error variant and cannot expose that checked panic channel; move it into a checked Result-returning function and consume that Result"));
      }
      if (callEdges?.get(node)?.callee || resolveLocalCallee(node, checker, functions, functionByNode)) {
        ts.forEachChild(node, visit);
        return;
      }
      if (isPanicCall(node, checker)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1505", "top-level panic cannot be represented as a checked Result; move it into a checked Result-returning function and consume that Result"));
      } else {
        const policy = foreignPolicy(node, checker, sourceFile, diagnostics);
        if (policy && policy.kind !== "never") {
          diagnostics.push(at(node, sourceFile, "SMITHERS1505", "an untrusted foreign call at top level cannot expose its checked panic channel; move it into a checked Result-returning function and consume that Result"));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * Heap provenance is intentionally bounded, but every supported foreign value
 * flow is checker-backed. Unsupported execution/escape sites are hard errors:
 * accepting them would be less honest than leaving the source untransformed.
 */
function checkForeignValueBoundaries(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): void {
  const visit = (node: ts.Node, inheritedOwner?: SemanticFunction): void => {
    const owner = isSupportedFunctionLike(node) ? functionByNode.get(node) ?? inheritedOwner : inheritedOwner;

    if (ts.isCallExpression(node)) {
      const edge = callEdges.get(node);
      if (edge?.foreign) {
        for (const argument of node.arguments) {
          if (!containsCallableValue(argument, checker)) continue;
          diagnostics.push(at(
            argument,
            sourceFile,
            "SMITHERS1509",
            "a callback may escape into foreign code beyond the checked call scope; expose an owned Smithers wrapper/adapter with an explicit Result or structured-task callback policy",
          ));
          recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
        }
      } else if (!edge?.panicExit) {
        for (const argument of node.arguments) {
          if (!containsForeignExecutableValue(argument, checker, callEdges)) continue;
          diagnostics.push(at(
            argument,
            sourceFile,
            "SMITHERS1508",
            "foreign callable provenance would escape through an unchecked higher-order call; wrap it in a local adapter that owns invocation and exposes an explicit Result/task contract",
          ));
          recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      checkForeignPropertyAccess(node, owner, sourceFile, checker, diagnostics, callEdges);
    }

    if (ts.isVariableDeclaration(node) && (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) &&
      node.initializer) {
      const origin = foreignValueOrigin(node.initializer, checker);
      if (origin && !origin.namespaceObject) {
        diagnostics.push(at(
          node.name,
          sourceFile,
          "SMITHERS1506",
          "destructuring a foreign value can execute untyped accessors and has no expression-safe Result lowering; read it through an annotated getter/factory adapter instead",
        ));
        recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer && ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) === 0 &&
      containsForeignExecutableValue(node.initializer, checker, callEdges)) {
      diagnostics.push(at(
        node.initializer,
        sourceFile,
        "SMITHERS1508",
        "a mutable alias cannot retain foreign panic provenance in this POC; use a const local adapter with an explicit Result contract",
      ));
      recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
    }

    if (ts.isNewExpression(node)) {
      const origin = foreignValueOrigin(node.expression, checker);
      if (origin) {
        const signature = checker.getResolvedSignature(node);
        const policy = foreignPolicyFromDeclaration(
          signature?.declaration,
          false,
          node,
          sourceFile,
          checker,
          diagnostics,
        );
        if (policy.kind !== "never") {
          diagnostics.push(at(
            node,
            sourceFile,
            "SMITHERS1504",
            "a foreign constructor can execute JavaScript but constructor Result lowering is deferred; expose an annotated factory function or Smithers adapter (only a checker-resolved @throws {never} constructor is accepted)",
          ));
          if (owner) addForeignFailures(owner.directFailures, policy);
        }
      }
    }

    if (ts.isReturnStatement(node) && node.expression && !ts.isNewExpression(node.expression) &&
      containsForeignExecutableValue(node.expression, checker, callEdges)) {
      diagnostics.push(at(
        node.expression,
        sourceFile,
        "SMITHERS1508",
        "returning an executable foreign value would lose its panic provenance; return a Smithers-owned adapter with an explicit Result/task contract instead",
      ));
      recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      containsForeignExecutableValue(node.right, checker, callEdges)) {
      diagnostics.push(at(
        node.right,
        sourceFile,
        "SMITHERS1508",
        "storing a foreign callable through a mutable/opaque reference loses panic provenance; use an immutable local adapter with an explicit Result contract",
      ));
      recordForeignBoundary(owner, { kind: "panic", async: false, lowerable: false });
    }

    ts.forEachChild(node, (child) => visit(child, owner));
  };
  visit(sourceFile);
}

function checkForeignPropertyAccess(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  owner: SemanticFunction | undefined,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): void {
  const receiver = foreignValueOrigin(access.expression, checker);
  if (!receiver || receiver.namespaceObject) return;

  const policy = foreignAccessPolicy(access, sourceFile, checker, diagnostics);
  if (foreignAccessIsCovered(access, callEdges, checker) && policy.kind !== "declared") return;
  if (policy.kind === "never") return;
  diagnostics.push(at(
    access,
    sourceFile,
    "SMITHERS1506",
    "foreign property/accessor evaluation can throw but expression-safe Result lowering is deferred; expose a checker-annotated getter/factory function or a Smithers wrapper adapter",
  ));
  if (owner) addForeignFailures(owner.directFailures, policy);
}

function foreignAccessIsCovered(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  checker: ts.TypeChecker,
): boolean {
  let current: ts.Node = access;
  for (let parent = current.parent; parent; current = parent, parent = parent.parent) {
    if (isSupportedFunctionLike(parent)) return false;
    if (ts.isNewExpression(parent) && parent.expression === current) return current === access;
    if (ts.isNonNullExpression(parent) && parent.expression === current) return true;
    if (ts.isCallExpression(parent)) {
      const foreign = callEdges.get(parent)?.foreign;
      if (!foreign) return false;
      if (parent.expression === current && current === access) return true;
      // The whole original call (callee chain and arguments) is evaluated inside
      // Result.try/tryPromise. A trusted `never` call has no such catch scope.
      return foreign.kind !== "never" && foreign.lowerable;
    }
    if (ts.isStatement(parent) || ts.isVariableDeclaration(parent)) return false;
  }
  return false;
}

function foreignAccessPolicy(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): ForeignPolicy {
  const location = ts.isPropertyAccessExpression(access) ? access.name : access.argumentExpression;
  const symbol = unalias(location ? checker.getSymbolAtLocation(location) : undefined, checker);
  const write = ts.isBinaryExpression(access.parent) && access.parent.left === access;
  const eligible = (symbol?.declarations ?? []).filter((declaration) => write
    ? ts.isSetAccessorDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)
    : ts.isGetAccessorDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration));
  const declaration = eligible.find((candidate) => readThrowsAnnotation(candidate, checker)) ?? eligible[0];
  return foreignPolicyFromDeclaration(declaration, false, access, sourceFile, checker, diagnostics);
}

function foreignPolicyFromDeclaration(
  declaration: ts.Node | undefined,
  async: boolean,
  boundary: ts.Node,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): ForeignPolicy {
  const annotation = readThrowsAnnotation(declaration, checker);
  if (!annotation) return { kind: "panic", async, lowerable: false };
  if (annotation === "never") return { kind: "never", async, lowerable: false };
  if (!/^[A-Za-z_$][\w$]*$/.test(annotation)) {
    diagnostics.push(at(boundary, sourceFile, "SMITHERS1502", `foreign @throws {${annotation}} is not reifiable in this POC; use one imported Error class constructor`));
    return { kind: "panic", async, lowerable: false };
  }
  return { kind: "declared", errorName: annotation, async, lowerable: false };
}

function recordForeignBoundary(owner: SemanticFunction | undefined, policy: ForeignPolicy): void {
  if (!owner) return;
  addForeignFailures(owner.directFailures, policy);
}

function containsCallableValue(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): boolean {
  if (isSupportedFunctionLike(expression)) return true;
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return containsCallableValue(expression.expression, checker, seen);
  }
  const type = checker.getTypeAtLocation(expression);
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return true;
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) => {
      if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)) return true;
      if (ts.isPropertyAssignment(property)) return containsCallableValue(property.initializer, checker, new Set(seen));
      if (ts.isShorthandPropertyAssignment(property)) return containsCallableValue(property.name, checker, new Set(seen));
      if (ts.isSpreadAssignment(property)) return containsCallableValue(property.expression, checker, new Set(seen));
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some((element) => ts.isExpression(element) && containsCallableValue(element, checker, new Set(seen)));
  }
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(checker.getSymbolAtLocation(expression), checker);
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find(ts.isVariableDeclaration);
    return Boolean(declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
      containsCallableValue(declaration.initializer, checker, seen));
  }
  return false;
}

function containsForeignExecutableValue(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  seen = new Set<ts.Symbol>(),
): boolean {
  if (foreignValueOrigin(expression, checker) && foreignValueCanExecute(expression, checker, callEdges)) return true;
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return containsForeignExecutableValue(expression.expression, checker, callEdges, seen);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return containsForeignExecutableValue(property.initializer, checker, callEdges, new Set(seen));
      if (ts.isShorthandPropertyAssignment(property)) return containsForeignExecutableValue(property.name, checker, callEdges, new Set(seen));
      if (ts.isSpreadAssignment(property)) return containsForeignExecutableValue(property.expression, checker, callEdges, new Set(seen));
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some((element) => ts.isExpression(element) &&
      containsForeignExecutableValue(element, checker, callEdges, new Set(seen)));
  }
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(checker.getSymbolAtLocation(expression), checker);
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find(ts.isVariableDeclaration);
    return Boolean(declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
      containsForeignExecutableValue(declaration.initializer, checker, callEdges, seen));
  }
  return false;
}

function foreignValueCanExecute(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  const type = semanticExpressionShape(expression, checker, callEdges).successType ?? checker.getTypeAtLocation(expression);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
  if (type.isUnion()) return type.types.some((part) => foreignTypeCanExecute(part));
  return foreignTypeCanExecute(type);
}

function foreignTypeCanExecute(type: ts.Type): boolean {
  return type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0 ||
    (type.flags & ts.TypeFlags.Object) !== 0;
}

function createProgram(source: string, requestedName?: string): {
  fileName: string;
  sourceFile: ts.SourceFile;
  program: ts.Program;
  checker: ts.TypeChecker;
} {
  const requested = requestedName && !requestedName.startsWith("<")
    ? resolve(requestedName)
    : resolve(process.cwd(), "__smithers_memory__.sm");
  const fileName = requested.endsWith(".sm") ? `${requested}.ts` : requested;
  const preludeName = resolve(dirname(fileName), PRELUDE_NAME);
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.Preserve,
    allowImportingTsExtensions: true,
  };
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const preludeFile = ts.createSourceFile(preludeName, PRELUDE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const resolved = resolve(name);
    if (resolved === fileName) return sourceFile;
    if (resolved === preludeName) return preludeFile;
    return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => {
    const resolved = resolve(name);
    return resolved === fileName || resolved === preludeName || originalFileExists(name);
  };
  host.readFile = (name) => {
    const resolved = resolve(name);
    if (resolved === fileName) return source;
    if (resolved === preludeName) return PRELUDE;
    return originalReadFile(name);
  };
  const program = ts.createProgram({ rootNames: [fileName, preludeName], options: compilerOptions, host });
  return { fileName, sourceFile: program.getSourceFile(fileName) ?? sourceFile, program, checker: program.getTypeChecker() };
}

function collectFunctions(sourceFile: ts.SourceFile, checker: ts.TypeChecker): SemanticFunction[] {
  const functions: SemanticFunction[] = [];
  const usedNames = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (isSupportedFunctionLike(node) && node.body) {
      const baseName = functionDisplayName(node, sourceFile);
      const count = usedNames.get(baseName) ?? 0;
      usedNames.set(baseName, count + 1);
      const name = count === 0 ? baseName : `${baseName}#${count + 1}`;
      const declaredShape = functionShape(node, checker);
      functions.push({
        node,
        name,
        publicName: isPubliclyNamedFunction(node) ? baseName : undefined,
        exported: isExported(node),
        async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
        explicitReturn: Boolean(node.type),
        declaredShape,
        directFailures: new Set(declaredShape.channel.startsWith("result") ? declaredShape.failures : []),
        bodyFailures: new Set(),
        failures: new Set(declaredShape.channel.startsWith("result") ? declaredShape.failures : []),
        directRequirements: new Set(),
        requirements: new Set(),
        calls: [],
        provides: [],
        expectCalls: [],
        boundaryCallbacks: [],
        hasResultPropagation: false,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

function isSupportedFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node);
}

function isPubliclyNamedFunction(node: ts.FunctionLikeDeclaration): boolean {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
    (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name));
}

function functionDisplayName(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `<anonymous@${line + 1}:${character + 1}>`;
}

function functionShape(node: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): TypeShape {
  const signature = checker.getSignatureFromDeclaration(node);
  const type = node.type
    ? checker.getTypeFromTypeNode(node.type)
    : signature
      ? checker.getReturnTypeOfSignature(signature)
      : checker.getAnyType();
  return shapeOfType(type, checker);
}

export function shapeOfType(type: ts.Type, checker: ts.TypeChecker): TypeShape {
  const promised = promisedType(type, checker);
  if (promised) {
    const inner = shapeOfType(promised, checker);
    return { ...inner, async: true };
  }
  const name = nominalTypeName(type);
  const arguments_ = typeArguments(type, checker);
  if (name === "Result") {
    const success = arguments_[0];
    const error = arguments_[1];
    return {
      channel: "result",
      async: false,
      failures: error ? errorNames(error, checker) : new Set(["Error"]),
      successType: success,
    };
  }
  return { channel: "plain", async: false, failures: new Set(), successType: type };
}

function nominalTypeName(type: ts.Type): string | undefined {
  return type.aliasSymbol?.getName() ?? type.getSymbol()?.getName() ??
    ((type as ts.TypeReference).target?.getSymbol()?.getName());
}

function typeArguments(type: ts.Type, checker: ts.TypeChecker): readonly ts.Type[] {
  const aliasArguments = (type as ts.TypeReference).aliasTypeArguments;
  if (aliasArguments?.length) return aliasArguments;
  if ((type.flags & ts.TypeFlags.Object) !== 0 && ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0) {
    return checker.getTypeArguments(type as ts.TypeReference);
  }
  return [];
}

function promisedType(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  const name = nominalTypeName(type);
  if (name !== "Promise" && name !== "PromiseLike") return undefined;
  return typeArguments(type, checker)[0] ?? checker.getAwaitedType(type);
}

/**
 * Module-qualified nominal row identities.
 *
 * A row member is serialized by its unqualified declaration name while that
 * name is unique across the analyzed project. When two modules declare the
 * same Error/Context name the identities would collide, so every colliding
 * declaration is serialized as `Name@module/path` instead. The qualifier is the
 * project-relative module path without its `.sm` extension, which is the same
 * module identity `stableErrorId` already uses for the runtime registration, so
 * the analysis row and the runtime nominal identity cannot drift apart.
 *
 * The naming is keyed by the checker that produced the symbols, so it stays
 * valid for the lowering pass that runs against the same program.
 */
interface RowNaming {
  readonly bySymbol: ReadonlyMap<ts.Symbol, string>;
}

const rowNamingByChecker = new WeakMap<ts.TypeChecker, RowNaming>();

export function moduleRowQualifier(displayName: string): string {
  return displayName.replace(/\.sm$/, "").replace(/[^A-Za-z0-9._/-]/g, "_");
}

function rowNameForSymbol(
  symbol: ts.Symbol | undefined,
  fallback: string,
  checker: ts.TypeChecker,
): string {
  if (!symbol) return fallback;
  return rowNamingByChecker.get(checker)?.bySymbol.get(symbol) ?? fallback;
}

/**
 * The row identity of a Context/Error class referenced through an identifier,
 * resolved past import aliases so a renamed import names the same row.
 */
function rowNameOfClassReference(
  reference: ts.Expression,
  checker: ts.TypeChecker,
  fallback: string,
): string {
  const symbol = unalias(checker.getSymbolAtLocation(reference), checker) ??
    checker.getTypeAtLocation(reference).getSymbol();
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  return rowNameForSymbol(symbol, declaration?.name?.text ?? fallback, checker);
}

function buildRowNaming(entries: readonly ProjectEntry[], checker: ts.TypeChecker): RowNaming {
  const declarationsByName = new Map<string, Array<{ symbol: ts.Symbol; displayName: string }>>();
  for (const entry of entries) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name && node.heritageClauses?.length) {
        const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
        const isRowClass = isErrorType(checker.getTypeAtLocation(node.name), checker) ||
          extendsImportedContext(node, checker);
        if (symbol && isRowClass) {
          const values = declarationsByName.get(node.name.text) ?? [];
          values.push({ symbol, displayName: entry.displayName });
          declarationsByName.set(node.name.text, values);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(entry.sourceFile);
  }
  const bySymbol = new Map<ts.Symbol, string>();
  for (const [name, values] of declarationsByName) {
    const distinct = new Set(values.map((value) => value.symbol));
    if (distinct.size < 2) continue;
    for (const value of values) {
      bySymbol.set(value.symbol, `${name}@${moduleRowQualifier(value.displayName)}`);
    }
  }
  return { bySymbol };
}

export function errorNamesOfType(type: ts.Type, checker: ts.TypeChecker): Set<string> {
  if (type.flags & ts.TypeFlags.Never) return new Set();
  if (type.isUnion()) {
    const names = new Set<string>();
    for (const part of type.types) for (const name of errorNamesOfType(part, checker)) names.add(name);
    return names;
  }
  const symbol = type.aliasSymbol ?? type.getSymbol();
  const name = symbol?.getName();
  if (name && name !== "__type") return new Set([rowNameForSymbol(symbol, name, checker)]);
  const rendered = checker.typeToString(type);
  return new Set([rendered]);
}

const errorNames = errorNamesOfType;

function collectErrorDeclarations(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  source: string,
): ErrorDeclaration[] {
  const result: ErrorDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const type = checker.getTypeAtLocation(node.name);
      if (isErrorType(type, checker) && node.heritageClauses?.length) {
        result.push({
          name: node.name.text,
          fieldsSource: source.slice(node.members.pos, node.members.end),
          start: node.getStart(sourceFile),
          end: node.end,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

export function isErrorType(type: ts.Type, checker: ts.TypeChecker, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.isUnion()) return type.types.every((part) => isErrorType(part, checker, new Set(seen)));
  // A row-variable type parameter is an Error exactly when it is constrained to
  // one. An unconstrained parameter stays a non-Error throw (SMITHERS1103).
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    const constraint = checker.getBaseConstraintOfType(type);
    return constraint !== undefined && constraint !== type && isErrorType(constraint, checker, seen);
  }
  if (nominalTypeName(type) === "Error") return true;
  if ((type.flags & ts.TypeFlags.Object) === 0) return false;
  const bases = checker.getBaseTypes(type as ts.InterfaceType) ?? [];
  return bases.some((base) => isErrorType(base, checker, seen));
}

function collectFacts(
  fn: SemanticFunction,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  layerBindings: ReadonlyMap<ts.Symbol, ts.Expression>,
  diagnostics: PendingDiagnostic[],
  callEdges: Map<ts.CallExpression, CallEdge>,
): void {
  const body = fn.node.body;
  if (!body) return;
  const authoredBoundary = isAuthoredResultBoundaryBody(fn.node, checker);

  const visit = (node: ts.Node, caughtByJavaScript = false): void => {
    if (node !== body && isSupportedFunctionLike(node)) return;

    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, caughtByJavaScript || Boolean(node.catchClause));
      if (node.catchClause) visit(node.catchClause.block, caughtByJavaScript);
      if (node.finallyBlock) visit(node.finallyBlock, caughtByJavaScript);
      return;
    }

    if (ts.isThrowStatement(node) && node.expression && !caughtByJavaScript) {
      const thrown = checker.getTypeAtLocation(node.expression);
      if (!isErrorType(thrown, checker)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1103", "recoverable throw values must extend Error; use panic(...) for an unknown defect"));
      } else {
        for (const name of errorNames(thrown, checker)) fn.directFailures.add(name);
      }
    }

    if (ts.isCallExpression(node)) {
      if (isPromiseInstanceChain(node, checker)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1401", "Promise instance .then(), .catch(), and .finally() are unavailable in authored .sm; consume the Promise with await"));
      }

      const capability = contextRequirement(node, checker);
      if (capability) fn.directRequirements.add(capability);

      const panicExit = isPanicCall(node, checker);
      const callee = panicExit ? undefined : resolveLocalCallee(node, checker, functions, functionByNode);
      // Inside an authored Result.try/tryPromise callback the boundary itself
      // owns the throw scope, so foreign-policy adapter diagnostics are moot.
      const foreign = panicExit || callee
        ? undefined
        : foreignPolicy(node, checker, sourceFile, authoredBoundary ? [] : diagnostics);
      const propagatesFailure = panicExit || callPropagates(node, checker, callee, foreign);
      let instantiatedFailures: ReadonlySet<string> | undefined;
      if (callee && genericRowTemplate(callee, checker)) {
        const instantiation = instantiateFailureRow(node, checker);
        if (instantiation.ok) {
          instantiatedFailures = instantiation.failures;
          const uncovered = uncoveredCallbackRowNames(
            node,
            instantiation.failures,
            checker,
            functions,
            functionByNode,
          );
          if (uncovered.length > 0) {
            diagnostics.push(at(
              node,
              sourceFile,
              "SMITHERS1806",
              `instantiating '${callee.name}' here publishes the failure row ${
                formatSet(instantiation.failures)
              }, which a callback argument's declared ${uncovered.join(" | ")} cannot produce; correct the type arguments or widen the row`,
            ));
          }
        } else {
          diagnostics.push(at(
            node,
            sourceFile,
            "SMITHERS1803",
            `the failure row of generic call '${callee.name}' is a template over its type parameters and ${
              instantiation.unresolved.join(" | ")
            } is still unresolved at this call site; supply concrete type arguments or wrap the call in an explicitly checked non-generic function`,
          ));
        }
      }
      const edge: CallEdge = {
        node,
        callee,
        foreign,
        panicExit,
        propagatesFailure,
        authoredBoundary: authoredBoundary && Boolean(foreign),
        instantiatedFailures,
      };
      if (callee || foreign || panicExit) {
        fn.calls.push(edge);
        callEdges.set(node, edge);
      }
      if (panicExit) {
        fn.directFailures.add("Panic");
        if (!isSimplePanicExit(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1503", "panic(...) lowering is currently supported only as an expression statement or direct return"));
        }
      }
      if (foreign && propagatesFailure && !authoredBoundary) addForeignFailures(fn.directFailures, foreign);

      if (isExpectSyntax(node)) fn.expectCalls.push(node);
      if (isPreludeResultBoundaryCall(node, checker)) {
        const boundaryBody = node.arguments[0];
        const callback = boundaryBody && isSupportedFunctionLike(boundaryBody)
          ? functionByNode.get(boundaryBody)
          : undefined;
        if (callback) fn.boundaryCallbacks.push(callback);
      }

      if (isLayerCall(node, checker, "provide")) {
        const layer = node.arguments[0];
        const callback = node.arguments[1];
        const resolved = layer ? resolveLayerExpression(layer, checker, layerBindings) : { values: new Set<string>(), complete: false };
        fn.provides.push({
          node,
          callback: callback && isSupportedFunctionLike(callback) ? functionByNode.get(callback) : undefined,
          callbackReference: callback ? resolveFunctionReference(callback, checker, functions, functionByNode) : undefined,
          provided: resolved.values,
          complete: resolved.complete,
        });
      }
    }

    if (ts.isReturnStatement(node) && node.expression) {
      const shape = semanticExpressionShape(node.expression, checker, callEdges);
      if (shape.channel.startsWith("result")) {
        for (const failure of shape.failures) fn.directFailures.add(failure);
      }
    }

    ts.forEachChild(node, (child) => visit(child, caughtByJavaScript));
  };
  visit(body);
  collectResultPropagations(body, fn, checker, callEdges);
}

/**
 * Collect postfix propagation only after call edges for the whole function are
 * available. A foreign or inferred-fallible call still has its authored
 * TypeScript success type, so inspecting a `NonNullExpression` during the
 * pre-order call walk would miss exactly the Result shape the semantic graph
 * supplies.
 */
function collectResultPropagations(
  body: ts.ConciseBody,
  fn: SemanticFunction,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): void {
  const visit = (node: ts.Node): void => {
    if (node !== body && isSupportedFunctionLike(node)) return;
    if (ts.isNonNullExpression(node)) {
      const shape = semanticExpressionShape(node.expression, checker, callEdges);
      if (shape.channel.startsWith("result")) {
        fn.hasResultPropagation = true;
        for (const failure of shape.failures) fn.directFailures.add(failure);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
}

function resolveLocalCallee(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): SemanticFunction | undefined {
  const declaration = checker.getResolvedSignature(call)?.declaration;
  if (declaration) {
    const direct = functionByNode.get(declaration);
    if (direct) return direct;
  }
  const symbol = expressionSymbol(call.expression, checker);
  if (!symbol) return undefined;
  return functions.find((candidate) => functionSymbol(candidate.node, checker) === symbol);
}

function resolveFunctionReference(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
): SemanticFunction | undefined {
  if (isSupportedFunctionLike(expression)) return functionByNode.get(expression);
  const symbol = expressionSymbol(expression, checker);
  return symbol ? functions.find((candidate) => functionSymbol(candidate.node, checker) === symbol) : undefined;
}

function functionSymbol(node: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (node.name) return unalias(checker.getSymbolAtLocation(node.name), checker);
  if (ts.isVariableDeclaration(node.parent)) return unalias(checker.getSymbolAtLocation(node.parent.name), checker);
  return undefined;
}

function expressionSymbol(expression: ts.Expression, checker: ts.TypeChecker): ts.Symbol | undefined {
  const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  return unalias(checker.getSymbolAtLocation(location), checker);
}

function unalias(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (!symbol) return undefined;
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

function callPropagates(
  call: ts.CallExpression,
  _checker: ts.TypeChecker,
  _callee: SemanticFunction | undefined,
  _foreign: ForeignPolicy | undefined,
): boolean {
  let current: ts.Node = call;
  let parent = current.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) || ts.isAwaitExpression(parent))) {
    current = parent;
    parent = parent.parent;
  }
  if (parent && ts.isNonNullExpression(parent) && parent.expression === current) return true;
  if (ts.isReturnStatement(parent)) return true;
  return isReturnedOrPropagated(call);
}

function isReturnedOrPropagated(node: ts.Node): boolean {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isAwaitExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isReturnStatement(parent)) return true;
    return ts.isNonNullExpression(parent) && parent.expression === current;
  }
}

function inferRows(
  functions: readonly SemanticFunction[],
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): void {
  for (const fn of functions) {
    for (const failure of fn.directFailures) fn.bodyFailures.add(failure);
    for (const requirement of fn.directRequirements) fn.requirements.add(requirement);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      for (const call of fn.calls) {
        if (!call.callee) continue;
        if (call.propagatesFailure) {
          // A polymorphic callee contributes its site-instantiated row, never
          // its template, so two call sites cannot merge each other's rows.
          for (const failure of call.instantiatedFailures ?? call.callee.failures) {
            changed = add(fn.bodyFailures, failure) || changed;
          }
        }
        for (const requirement of call.callee.requirements) changed = add(fn.requirements, requirement) || changed;
      }
      // `.expect(...)` consumes a Result but converts its error variant into a
      // panic; that distinguished channel must stay visible on the caller.
      for (const expectCall of fn.expectCalls) {
        const receiver = (expectCall.expression as ts.PropertyAccessExpression).expression;
        if (semanticExpressionShape(receiver, checker, callEdges).channel.startsWith("result")) {
          changed = add(fn.bodyFailures, "Panic") || changed;
        }
      }
      // An authored Result.try/tryPromise boundary owns its callback's throw
      // scope but still executes the callback's capability requirements.
      for (const callback of fn.boundaryCallbacks) {
        for (const requirement of callback.requirements) changed = add(fn.requirements, requirement) || changed;
      }
      for (const provide of fn.provides) {
        const callback = provide.callback ?? provide.callbackReference;
        if (!callback) continue;
        for (const requirement of callback.requirements) {
          if (!provide.provided.has(requirement)) changed = add(fn.requirements, requirement) || changed;
        }
      }
      const contract = fn.explicitReturn && fn.declaredShape.channel.startsWith("result");
      const target = contract ? fn.declaredShape.failures : fn.bodyFailures;
      for (const failure of target) changed = add(fn.failures, failure) || changed;
    }
  }
}

function checkFunctionContracts(
  functions: readonly SemanticFunction[],
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  for (const fn of functions) {
    const isResult = fn.declaredShape.channel.startsWith("result");
    const hasFailures = fn.bodyFailures.size > 0;
    if (fn.explicitReturn && !isResult && hasFailures) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1101", `explicit return type cannot represent recoverable failures ${formatSet(fn.bodyFailures)}; use Result<A, E>${fn.async ? " inside Promise" : ""}`));
    }
    if (fn.explicitReturn && isResult) {
      const extra = difference(fn.bodyFailures, fn.declaredShape.failures);
      if (extra.size > 0) {
        diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1104", `Result contract omits reachable failures ${formatSet(extra)}`));
      }
    }
    if (fn.exported && hasFailures && !fn.explicitReturn) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1102", "exported fallible functions must spell Result<A, E> (or Promise<Result<A, E>>) in their public contract"));
    }
    if ((ts.isConstructorDeclaration(fn.node) || ts.isGetAccessorDeclaration(fn.node) || ts.isSetAccessorDeclaration(fn.node)) && hasFailures) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1105", "constructors and accessors cannot carry a Result channel in this POC; move the fallible work into an ordinary method"));
    }
    if (fn.node.asteriskToken && hasFailures) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1106", "fallible generators are deferred until generator/Result control-flow semantics are specified"));
    }
    if (fn.hasResultPropagation && !isResult && fn.bodyFailures.size === 0) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1202", "postfix ! propagation requires an enclosing Result-returning function"));
    }
    // A row that names one of this declaration's own type parameters is a
    // template. Templates are only instantiable through a spelled `Result`
    // contract, so a leaked row variable without one fails closed here rather
    // than serializing a type-parameter name as a nominal row member.
    if (fn.node.typeParameters?.length && !genericRowTemplate(fn, checker)) {
      const leaked = fn.node.typeParameters
        .map((parameter) => parameter.name.text)
        .filter((name) => fn.bodyFailures.has(name))
        .sort(compareText);
      if (leaked.length > 0) {
        diagnostics.push(at(
          fn.node,
          fn.node.getSourceFile(),
          "SMITHERS1803",
          `the failure row of generic '${fn.name}' depends on its type parameter${leaked.length > 1 ? "s" : ""} ${
            leaked.join(" | ")
          } but no Result contract spells that row; declare Result<A, ${leaked.join(" | ")}> so each call site can instantiate it`,
        ));
      }
    }
    checkNestedChannels(fn, checker, diagnostics);
  }
}

function checkNestedChannels(fn: SemanticFunction, checker: ts.TypeChecker, diagnostics: PendingDiagnostic[]): void {
  if (!fn.node.type) return;
  const text = checker.typeToString(checker.getTypeFromTypeNode(fn.node.type));
  if (/Result<\s*Result</.test(text)) {
    diagnostics.push(at(fn.node.type, fn.node.getSourceFile(), "SMITHERS1203", "nested Result normalization is not specified; make the conversion explicit"));
  }
}

export function effectiveChannel(fn: SemanticFunction): FunctionChannel {
  if (fn.declaredShape.channel !== "plain") return fn.declaredShape.channel;
  return fn.failures.size > 0 ? "result" : "plain";
}

function add(set: Set<string>, value: string): boolean {
  const before = set.size;
  set.add(value);
  return set.size !== before;
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  return new Set([...left].filter((value) => !right.has(value)));
}

function formatSet(values: ReadonlySet<string>): string {
  return [...values].sort().join(" | ") || "never";
}

function foreignPolicy(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  diagnostics: PendingDiagnostic[],
): ForeignPolicy | undefined {
  const signature = checker.getResolvedSignature(call);
  const declaration = signature?.declaration;
  const origin = foreignValueOrigin(call.expression, checker);
  if (!origin) return undefined;

  const annotation = readThrowsAnnotation(declaration, checker);
  const stableCallee = isStableForeignCallee(call.expression, checker);
  const unsafeUse = annotation !== "never" && foreignResultIsUsedAsValue(call, checker);
  const lowerable = stableCallee && !origin.uncheckedResult && !unsafeUse;
  if (!lowerable) {
    diagnostics.push(at(
      call,
      sourceFile,
      "SMITHERS1507",
      "this foreign call/result use is not expression-order-safe in the POC; assign the checked result, propagate it with postfix !, and continue through an explicitly typed local adapter",
    ));
  }

  const resultType = signature ? checker.getReturnTypeOfSignature(signature) : checker.getTypeAtLocation(call);
  const async = Boolean(promisedType(resultType, checker));
  if (!annotation) return { kind: "panic", async, lowerable };
  if (annotation === "never") return { kind: "never", async, lowerable };
  if (!/^[A-Za-z_$][\w$]*$/.test(annotation)) {
    diagnostics.push(at(call, sourceFile, "SMITHERS1502", `foreign @throws {${annotation}} is not reifiable in this POC; use one imported Error class constructor`));
    return { kind: "panic", async, lowerable };
  }
  const errorValuePath = foreignErrorValuePath(annotation, declaration, call, checker);
  if (!errorValuePath) {
    diagnostics.push(at(
      call,
      sourceFile,
      "SMITHERS1502",
      `foreign @throws {${annotation}} has no checker-matching Error constructor value in scope; import that Error class (named, aliased, or through a namespace) or provide an adapter`,
    ));
    return { kind: "panic", async, lowerable };
  }
  return { kind: "declared", errorName: annotation, errorValuePath, async, lowerable };
}

function isStableForeignCallee(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression)) {
    return isStableForeignCallee(expression.expression, checker);
  }
  // A postfix propagation boundary turns a checked foreign Result back into
  // its callable success value. The operator is recognized from its AST kind;
  // there is no member spelling whose text could be forged or shadowed.
  if (ts.isNonNullExpression(expression)) return true;
  if (ts.isIdentifier(expression)) return true;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return isStableForeignCallee(expression.expression, checker);
  }
  return false;
}

/** Prevent emitting `Result.try(() => make())(...)` before the checked result is propagated. */
function foreignResultIsUsedAsValue(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  let current: ts.Node = call;
  let parent = current.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) || ts.isAwaitExpression(parent))) {
    current = parent;
    parent = parent.parent;
  }
  if (parent && ts.isNonNullExpression(parent) && parent.expression === current) return false;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) return true;
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === current) return true;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === current) return true;
  if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.expression === current) return true;
  if ((ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) && parent.expression === current) return true;
  if (ts.isSwitchStatement(parent) && parent.expression === current) return true;
  if (ts.isThrowStatement(parent) || ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) return true;
  if (ts.isConditionalExpression(parent)) return parent.condition === current;
  if (ts.isArrayLiteralExpression(parent) || ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) ||
    ts.isReturnStatement(parent) || ts.isExpressionStatement(parent) ||
    (ts.isArrowFunction(parent) && parent.body === current)) return false;
  return Boolean(parent && ts.isExpression(parent));
}

function isPanicCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call);
  if (selection && ts.isIdentifier(selection.receiver) &&
    selection.receiver.text === "Reflect" && selection.name === "panic") {
    const symbol = checker.getSymbolAtLocation(selection.receiver);
    return Boolean(symbol?.declarations?.length) &&
      !symbol!.declarations!.some((declaration) => declaration.getSourceFile() === call.getSourceFile()) &&
      symbol!.declarations!.some((declaration) => isCompilerPrelude(declaration.getSourceFile()) || isTypeScriptLibrary(declaration.getSourceFile()));
  }
  if (!ts.isIdentifier(call.expression)) return false;
  const symbol = unalias(checker.getSymbolAtLocation(call.expression), checker);
  return symbol?.getName() === "panic" && Boolean(symbol.declarations?.some((declaration) =>
    isCompilerPrelude(declaration.getSourceFile())));
}

export function isPanicExitCall(call: ts.CallExpression, model: SemanticModel): boolean {
  return Boolean(model.callEdges.get(call)?.panicExit);
}

function isSimplePanicExit(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return ts.isExpressionStatement(current.parent) || ts.isReturnStatement(current.parent) ||
    (ts.isArrowFunction(current.parent) && current.parent.body === current);
}

function readThrowsAnnotation(
  declaration: ts.Node | undefined,
  checker: ts.TypeChecker,
): string | undefined {
  return jsDocThrowsText(findThrowsTag(declaration, checker));
}

function findThrowsTag(declaration: ts.Node | undefined, checker: ts.TypeChecker): ts.JSDocTag | undefined {
  if (!declaration) return undefined;
  const direct = ts.getJSDocTags(declaration).find((tag) =>
    tag.tagName.text === "throws" && !isModuleInitializationTag(tag));
  if (direct) return direct;
  const name = "name" in declaration ? (declaration as ts.NamedDeclaration).name : undefined;
  const symbol = name ? checker.getSymbolAtLocation(name) : undefined;
  return symbol?.declarations?.flatMap((candidate) => ts.getJSDocTags(candidate))
    .find((tag) => tag.tagName.text === "throws" && !isModuleInitializationTag(tag));
}

function isModuleInitializationTag(tag: ts.JSDocTag): boolean {
  // `@module` disambiguates the file-initialization trust claim from a
  // function-level `@throws` tag when the first statement is callable.
  return /@module(?:\s|\*|$)/i.test(tag.parent.getText());
}

function jsDocThrowsText(tag: ts.JSDocTag | undefined): string | undefined {
  if (!tag) return undefined;
  const typeExpression = (tag as ts.JSDocThrowsTag).typeExpression?.type;
  if (typeExpression) return typeExpression.getText().trim();
  const comment = typeof tag.comment === "string" ? tag.comment : undefined;
  const braced = comment?.match(/^\s*\{([^}]+)\}/);
  return braced?.[1]?.trim();
}

function foreignErrorValuePath(
  annotation: string,
  declaration: ts.Node | undefined,
  location: ts.Node,
  checker: ts.TypeChecker,
): readonly string[] | undefined {
  const tag = findThrowsTag(declaration, checker);
  const typeNode = (tag as ts.JSDocThrowsTag | undefined)?.typeExpression?.type;
  const annotationType = typeNode ? checker.getTypeAtLocation(typeNode) : undefined;
  const expected = annotationType
    ? unalias(annotationType.aliasSymbol ?? annotationType.getSymbol(), checker)
    : undefined;
  const sourceFile = location.getSourceFile();

  const matches = (node: ts.Identifier): boolean => {
    const symbol = checker.getSymbolAtLocation(node);
    const resolved = unalias(symbol, checker);
    if (expected && resolved !== expected) return false;
    const valueType = checker.getTypeAtLocation(node);
    return valueType.getConstructSignatures().some((signature) =>
      isErrorType(checker.getReturnTypeOfSignature(signature), checker));
  };

  const exact = checker.resolveName(annotation, location, ts.SymbolFlags.Value, false);
  if (exact) {
    const resolved = unalias(exact, checker);
    const valueType = checker.getTypeOfSymbolAtLocation(exact, location);
    if ((!expected || resolved === expected) && valueType.getConstructSignatures().some((signature) =>
      isErrorType(checker.getReturnTypeOfSignature(signature), checker))) return [annotation];
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    if (statement.importClause.name && matches(statement.importClause.name)) return [statement.importClause.name.text];
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if (matches(specifier.name)) return [specifier.name.text];
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      const moduleSymbol = unalias(checker.getSymbolAtLocation(bindings.name), checker);
      if (!moduleSymbol) continue;
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const resolved = unalias(exported, checker);
        if (expected ? resolved !== expected : exported.getName() !== annotation) continue;
        const name = exported.getName();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) return [bindings.name.text, name];
      }
    }
  }
  return undefined;
}

function addForeignFailures(target: Set<string>, policy: ForeignPolicy): void {
  if (policy.kind === "panic") target.add("Panic");
  if (policy.kind === "declared" && policy.errorName) {
    target.add(policy.errorName);
    target.add("Panic");
  }
}

function importedModuleOfExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): string | undefined {
  return foreignValueOrigin(expression, checker, seen)?.moduleName;
}

interface ForeignValueOrigin {
  readonly moduleName: string;
  /** ESM namespace reads are safe live-binding selection, not user accessors. */
  readonly namespaceObject: boolean;
  /** The value is the success of a call that will lower to Result and has not been propagated. */
  readonly uncheckedResult: boolean;
}

function foreignValueOrigin(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seenSymbols = new Set<ts.Symbol>(),
): ForeignValueOrigin | undefined {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isAwaitExpression(expression)) {
    return foreignValueOrigin(expression.expression, checker, seenSymbols);
  }
  if (ts.isNonNullExpression(expression)) {
    const origin = foreignValueOrigin(expression.expression, checker, seenSymbols);
    return origin && { ...origin, namespaceObject: false, uncheckedResult: false };
  }

  if (ts.isIdentifier(expression)) {
    const alias = checker.getSymbolAtLocation(expression);
    const imported = importOrigin(alias, checker);
    if (imported) return imported;

    const symbol = unalias(alias, checker);
    if (!symbol || seenSymbols.has(symbol)) return undefined;
    seenSymbols.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find((candidate) =>
      ts.isVariableDeclaration(candidate) || ts.isBindingElement(candidate));
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return foreignValueOrigin(declaration.initializer, checker, seenSymbols);
    }
    if (declaration && ts.isBindingElement(declaration)) {
      return bindingElementOrigin(declaration, checker, seenSymbols);
    }
    return undefined;
  }

  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const receiver = foreignValueOrigin(expression.expression, checker, new Set(seenSymbols));
    if (receiver) return { ...receiver, namespaceObject: false };

    const symbolLocation = ts.isPropertyAccessExpression(expression)
      ? expression.name
      : expression.argumentExpression;
    const symbol = unalias(symbolLocation ? checker.getSymbolAtLocation(symbolLocation) : undefined, checker);
    if (symbol && !seenSymbols.has(symbol)) {
      seenSymbols.add(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if (ts.isPropertyAssignment(declaration)) {
          const origin = foreignValueOrigin(declaration.initializer, checker, new Set(seenSymbols));
          if (origin) return origin;
        }
        if (ts.isShorthandPropertyAssignment(declaration)) {
          const value = checker.getShorthandAssignmentValueSymbol(declaration);
          const origin = originOfSymbolValue(value, checker, new Set(seenSymbols));
          if (origin) return origin;
        }
        if (ts.isPropertyDeclaration(declaration) && declaration.initializer) {
          const origin = foreignValueOrigin(declaration.initializer, checker, new Set(seenSymbols));
          if (origin) return origin;
        }
      }
    }
    return storedElementOrigin(expression, checker, seenSymbols);
  }

  if (ts.isCallExpression(expression)) {
    const origin = foreignValueOrigin(expression.expression, checker, seenSymbols);
    if (!origin) return undefined;
    const annotation = readThrowsAnnotation(checker.getResolvedSignature(expression)?.declaration, checker);
    return { moduleName: origin.moduleName, namespaceObject: false, uncheckedResult: annotation !== "never" };
  }
  if (ts.isNewExpression(expression)) {
    const origin = foreignValueOrigin(expression.expression, checker, seenSymbols);
    return origin && { moduleName: origin.moduleName, namespaceObject: false, uncheckedResult: false };
  }
  if (ts.isConditionalExpression(expression)) {
    const left = foreignValueOrigin(expression.whenTrue, checker, new Set(seenSymbols));
    const right = foreignValueOrigin(expression.whenFalse, checker, new Set(seenSymbols));
    if (!left) return right;
    if (!right) return left;
    return {
      moduleName: left.moduleName,
      namespaceObject: left.namespaceObject && right.namespaceObject,
      uncheckedResult: left.uncheckedResult || right.uncheckedResult,
    };
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return foreignValueOrigin(expression.right, checker, seenSymbols);
  }
  return undefined;
}

function importOrigin(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ForeignValueOrigin | undefined {
  if (!symbol) return undefined;
  const resolved = unalias(symbol, checker);
  if (resolved?.declarations?.some((declaration) => {
    const file = declaration.getSourceFile();
    return file.fileName.endsWith(".sm.ts") || isTrustedCompilerGeneratedRuntime(file);
  })) {
    return undefined;
  }
  for (const declaration of symbol.declarations ?? []) {
    let importDeclaration: ts.ImportDeclaration | undefined;
    let namespaceObject = false;
    if (ts.isImportSpecifier(declaration) && ts.isImportDeclaration(declaration.parent.parent.parent)) {
      importDeclaration = declaration.parent.parent.parent;
    } else if (ts.isNamespaceImport(declaration) && ts.isImportDeclaration(declaration.parent.parent)) {
      importDeclaration = declaration.parent.parent;
      namespaceObject = true;
    } else if (ts.isImportClause(declaration) && ts.isImportDeclaration(declaration.parent)) {
      importDeclaration = declaration.parent;
    }
    if (importDeclaration && ts.isStringLiteral(importDeclaration.moduleSpecifier)) {
      const moduleName = importDeclaration.moduleSpecifier.text;
      // Only exact compiler intrinsics are trusted; an npm package that merely
      // starts with the letters "smithers" (e.g. `smithersutils`) is foreign.
      if (!isCompilerIntrinsicSpecifier(moduleName)) return { moduleName, namespaceObject, uncheckedResult: false };
    }
  }
  return undefined;
}

function originOfSymbolValue(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
  seenSymbols: Set<ts.Symbol>,
): ForeignValueOrigin | undefined {
  if (!symbol) return undefined;
  const imported = importOrigin(symbol, checker);
  if (imported) return imported;
  const resolved = unalias(symbol, checker);
  if (!resolved || seenSymbols.has(resolved)) return undefined;
  seenSymbols.add(resolved);
  const declaration = resolved.valueDeclaration ?? resolved.declarations?.find(ts.isVariableDeclaration);
  return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
    ? foreignValueOrigin(declaration.initializer, checker, seenSymbols)
    : undefined;
}

function bindingElementOrigin(
  binding: ts.BindingElement,
  checker: ts.TypeChecker,
  seenSymbols: Set<ts.Symbol>,
): ForeignValueOrigin | undefined {
  const pattern = binding.parent;
  const declaration = pattern.parent;
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined;
  if (ts.isObjectBindingPattern(pattern)) {
    const key = binding.propertyName ?? binding.name;
    if (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNumericLiteral(key)) {
      const selected = objectLiteralMember(declaration.initializer, key.text, checker);
      if (selected) return foreignValueOrigin(selected, checker, seenSymbols);
    }
  }
  // Destructuring a genuinely foreign receiver invokes foreign property access;
  // the boundary pass rejects it, but retaining provenance prevents later calls
  // through the bound value from becoming invisible.
  return foreignValueOrigin(declaration.initializer, checker, seenSymbols);
}

function storedElementOrigin(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  checker: ts.TypeChecker,
  seenSymbols: Set<ts.Symbol>,
): ForeignValueOrigin | undefined {
  const key = ts.isPropertyAccessExpression(access)
    ? access.name.text
    : access.argumentExpression && (ts.isStringLiteral(access.argumentExpression) || ts.isNumericLiteral(access.argumentExpression))
      ? access.argumentExpression.text
      : undefined;
  if (key === undefined) return undefined;
  const selected = objectLiteralMember(access.expression, key, checker);
  return selected ? foreignValueOrigin(selected, checker, seenSymbols) : undefined;
}

function objectLiteralMember(
  expression: ts.Expression,
  key: string,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): ts.Expression | undefined {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) {
    return objectLiteralMember(expression.expression, key, checker, seen);
  }
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(checker.getSymbolAtLocation(expression), checker);
    if (!symbol || seen.has(symbol)) return undefined;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find(ts.isVariableDeclaration);
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return objectLiteralMember(declaration.initializer, key, checker, seen);
    }
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))
        ? property.name.text
        : undefined;
      if (name !== key) continue;
      if (ts.isPropertyAssignment(property)) return property.initializer;
      if (ts.isShorthandPropertyAssignment(property)) return property.name;
    }
  }
  if (ts.isArrayLiteralExpression(expression) && /^\d+$/.test(key)) return expression.elements[Number(key)];
  return undefined;
}

function isCompilerPrelude(file: ts.SourceFile): boolean {
  return file.fileName.endsWith(PRELUDE_NAME);
}

function isTypeScriptLibrary(file: ts.SourceFile): boolean {
  return file.hasNoDefaultLib || /[\\/]typescript[^/\\]*[\\/]lib[\\/]lib\.[^/\\]+\.d\.ts$/.test(file.fileName);
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return ("name" in parent && (parent as ts.NamedDeclaration).name === node) ||
    ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent);
}

function isPropertyNameNode(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node);
}

/** One member selection: `receiver.name` or, identically, `receiver["name"]`. */
export interface MemberSelection {
  readonly receiver: ts.Expression;
  readonly name: string;
  /** The node that spells the member; where a symbol for it resolves. */
  readonly nameNode: ts.Node;
}

/**
 * The member a `.name` or `["name"]` access selects.
 *
 * `x["m"]` is the SAME member access as `x.m` in TypeScript semantics — same
 * resolved property symbol, same emitted call — so every compiler-recognized
 * member has to be recognized through both spellings or the computed spelling
 * is a hole. Both directions matter: recognizing only the dotted spelling let
 * `Clock["context"]()` compile with an empty requirement row and panic at
 * runtime, and let `Layer["provide"]` skip its capability check; it also
 * reported false must-consume errors for `result["match"]({...})` and
 * `Result["all"]([...])`, which discharge the obligation exactly as the dotted
 * spellings do.
 *
 * A NON-literal key (`Clock[key]()`, `Clock["cont" + "ext"]()`) is deliberately
 * not a selection here. It selects no statically known member, so there is
 * nothing to recognize; the stock TypeScript check over the emitted module
 * refuses it (TS7053, measured) because a compiler-owned receiver has no string
 * index signature. `ts.isStringLiteralLike` is the same literal test the
 * ambient-authority recognizer already uses for `Date["now"]()`.
 */
export function memberSelection(node: ts.Node): MemberSelection | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return { receiver: node.expression, name: node.name.text, nameNode: node.name };
  }
  if (ts.isElementAccessExpression(node) && node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)) {
    return { receiver: node.expression, name: node.argumentExpression.text, nameNode: node.argumentExpression };
  }
  return undefined;
}

/** The member selection of a call's callee, when the callee selects a member. */
function calleeSelection(call: ts.CallExpression): MemberSelection | undefined {
  return memberSelection(call.expression);
}

function isInTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    const parent: ts.Node = current.parent;
    if (ts.isTypeNode(parent)) return true;
    if (ts.isExpression(parent) || ts.isStatement(parent) || ts.isSourceFile(parent)) return false;
    current = parent;
  }
  return false;
}

function contextRequirement(call: ts.CallExpression, checker: ts.TypeChecker): string | undefined {
  const selection = calleeSelection(call);
  if (!selection || selection.name !== "context" || call.arguments.length !== 0) {
    return undefined;
  }
  const receiver = selection.receiver;
  const type = checker.getTypeAtLocation(receiver);
  const symbol = type.getSymbol() ?? (ts.isIdentifier(receiver) ? unalias(checker.getSymbolAtLocation(receiver), checker) : undefined);
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  if (!declaration?.name || !extendsImportedContext(declaration, checker)) return undefined;
  return rowNameForSymbol(
    unalias(checker.getSymbolAtLocation(declaration.name), checker),
    declaration.name.text,
    checker,
  );
}

function extendsImportedContext(declaration: ts.ClassDeclaration, checker: ts.TypeChecker): boolean {
  const heritage = declaration.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
  for (const typeNode of heritage?.types ?? []) {
    const symbol = unalias(checker.getSymbolAtLocation(typeNode.expression), checker);
    if (symbol?.getName() === "Context") {
      const moduleName = importedModuleOfExpression(typeNode.expression, checker);
      if (moduleName === "smthrs/context" || symbol.declarations?.some((item) => isCompilerPrelude(item.getSourceFile()))) return true;
    }
    const base = symbol?.declarations?.find(ts.isClassDeclaration);
    if (base && extendsImportedContext(base, checker)) return true;
  }
  return false;
}

function isPromiseInstanceChain(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call);
  if (!selection) return false;
  if (!["then", "catch", "finally"].includes(selection.name)) return false;
  return Boolean(promisedType(checker.getTypeAtLocation(selection.receiver), checker));
}

function collectLayerBindings(sourceFile: ts.SourceFile, checker: ts.TypeChecker): Map<ts.Symbol, ts.Expression> {
  const result = new Map<ts.Symbol, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
      if (symbol) result.set(symbol, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function isLayerCall(call: ts.CallExpression, checker: ts.TypeChecker, method: string): boolean {
  const selection = calleeSelection(call);
  if (!selection || selection.name !== method) return false;
  const moduleName = importedModuleOfExpression(selection.receiver, checker);
  if (moduleName === "smthrs/provider") return true;
  const symbol = unalias(checker.getSymbolAtLocation(selection.receiver), checker);
  return symbol?.getName() === "Layer" && Boolean(symbol.declarations?.some((item) => isCompilerPrelude(item.getSourceFile())));
}

function resolveLayerExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ts.Expression>,
  seen = new Set<ts.Symbol>(),
): { values: Set<string>; complete: boolean } {
  if (ts.isParenthesizedExpression(expression)) return resolveLayerExpression(expression.expression, checker, bindings, seen);
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(checker.getSymbolAtLocation(expression), checker);
    const initializer = symbol && bindings.get(symbol);
    if (!symbol || !initializer || seen.has(symbol)) return { values: new Set(), complete: false };
    seen.add(symbol);
    return resolveLayerExpression(initializer, checker, bindings, seen);
  }
  if (!ts.isCallExpression(expression) || !calleeSelection(expression)) {
    return { values: new Set(), complete: false };
  }
  if (isLayerCall(expression, checker, "succeed")) {
    const capability = expression.arguments[0];
    const name = capability && ts.isIdentifier(capability)
      ? rowNameOfClassReference(capability, checker, capability.text)
      : undefined;
    return { values: new Set(name ? [name] : []), complete: Boolean(name) };
  }
  if (isLayerCall(expression, checker, "merge")) {
    const values = new Set<string>();
    let complete = true;
    for (const argument of expression.arguments) {
      const part = resolveLayerExpression(argument, checker, bindings, new Set(seen));
      for (const value of part.values) values.add(value);
      complete &&= part.complete;
    }
    return { values, complete };
  }
  return { values: new Set(), complete: false };
}

function checkLayerSatisfaction(
  sourceFile: ts.SourceFile,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  layerBindings: ReadonlyMap<ts.Symbol, ts.Expression>,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const checked = new Set<ts.CallExpression>();
  const check = (edge: ProvideEdge): void => {
    if (checked.has(edge.node)) return;
    checked.add(edge.node);
    const callback = edge.callback ?? edge.callbackReference;
    if (!callback) {
      diagnostics.push(at(edge.node, sourceFile, "SMITHERS2103", "Layer.provide callback must resolve to a checked local function in this POC"));
      return;
    }
    if (!edge.complete) {
      diagnostics.push(at(edge.node.arguments[0] ?? edge.node, sourceFile, "SMITHERS2104", "Layer expression is opaque; this POC cannot prove its provided capability closure"));
      return;
    }
    // Requirement rows are nominal `Context` capabilities only. There is no
    // built-in member to exempt here: `TypeScript` was withdrawn as a
    // requirement (specification/compatibility.mdx, "TypeScript Target", and
    // specification/type-system.mdx), so what is left after subtracting the
    // layer's provided closure is exactly the unprovided capabilities.
    const missing = difference(callback.requirements, edge.provided);
    if (missing.size > 0 && !nearestFunction(edge.node)) {
      diagnostics.push(at(edge.node, sourceFile, "SMITHERS2101", `Layer.provide is missing ${formatSet(missing)}`));
    }
  };
  for (const fn of functions) {
    if (fn.node.getSourceFile() !== sourceFile) continue;
    for (const edge of fn.provides) check(edge);
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isLayerCall(node, checker, "provide") && !checked.has(node)) {
      const layer = node.arguments[0];
      const callbackExpression = node.arguments[1];
      const resolved = layer ? resolveLayerExpression(layer, checker, layerBindings) : { values: new Set<string>(), complete: false };
      check({
        node,
        callback: callbackExpression && isSupportedFunctionLike(callbackExpression) ? functionByNode.get(callbackExpression) : undefined,
        callbackReference: callbackExpression ? resolveFunctionReference(callbackExpression, checker, functions, functionByNode) : undefined,
        provided: resolved.values,
        complete: resolved.complete,
      });
    }
    if (ts.isCallExpression(node) && !nearestFunction(node)) {
      const callee = resolveLocalCallee(node, checker, functions, functionByNode);
      if (callee && callee.requirements.size > 0 && !isInsideLayerCallback(node, checker)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS2102", `top-level call has unsatisfied requirements ${formatSet(callee.requirements)}`));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function checkCallbackOwnership(
  sourceFile: ts.SourceFile,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    for (const argument of node.arguments) {
      const callback = isSupportedFunctionLike(argument)
        ? functionByNode.get(argument)
        : resolveFunctionReference(argument, checker, functions, functionByNode);
      if (!callback) continue;
      const isProvideCallback = isLayerCall(node, checker, "provide") && node.arguments[1] === argument;
      if (callback.bodyFailures.size > 0 && !callback.declaredShape.channel.startsWith("result")) {
        diagnostics.push(at(
          argument,
          sourceFile,
          isProvideCallback ? "SMITHERS2105" : "SMITHERS1303",
          isProvideCallback
            ? "fallible Layer.provide callbacks need an explicit Result (or Promise<Result>) contract so the provided computation keeps its failure channel"
            : "an inferred-fallible function value cannot cross a callback boundary; add an explicit Result contract or handle its failures before passing it",
        ));
      }
      if (callback.async) {
        const consumedProvide = isProvideCallback && producerConsumed(node, "promise", checker, callEdges);
        // Result.tryPromise invokes its body exactly once and awaits it, so
        // the boundary itself owns the async callback's lifetime.
        const ownedBoundaryBody = node.arguments[0] === argument &&
          calleeSelection(node)?.name === "tryPromise" &&
          isPreludeResultBoundaryCall(node, checker);
        if (!consumedProvide && !ownedBoundaryBody) {
          diagnostics.push(at(
            argument,
            sourceFile,
            "SMITHERS1404",
            "async callback invocation ownership is not proven here; use an explicit structured-concurrency combinator or await/return a recognized Layer.provide computation",
          ));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isInsideLayerCallback(node: ts.Node, checker: ts.TypeChecker): boolean {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    if (isSupportedFunctionLike(current) && ts.isCallExpression(current.parent) &&
      isLayerCall(current.parent, checker, "provide") && current.parent.arguments[1] === current) return true;
    current = current.parent;
  }
  return false;
}

export function semanticExpressionShape(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  seenSymbols = new Set<ts.Symbol>(),
): TypeShape {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression)) {
    return semanticExpressionShape(expression.expression, checker, callEdges, seenSymbols);
  }
  if (ts.isNonNullExpression(expression)) {
    const operand = semanticExpressionShape(expression.expression, checker, callEdges, seenSymbols);
    // `!` extracts from a Result. `Promise<Result<A, E>>` is a Promise, not a
    // Result — type-system.mdx: "Awaiting the call removes only the Promise
    // layer" — so `!` alone cannot extract from one, and treating it as an
    // extraction would hand the caller a plain value that is really an
    // un-awaited Promise.
    if (operand.channel.startsWith("result") && !operand.async) {
      return {
        channel: "plain",
        async: false,
        failures: new Set(),
        successType: operand.successType,
      };
    }
    // The validation pass reports SMITHERS1207 for this removed TypeScript
    // assertion meaning. Preserve the operand shape here so no later analysis
    // can accidentally treat the invalid assertion as a successful extraction.
    return operand;
  }
  if (ts.isAwaitExpression(expression)) {
    const inner = semanticExpressionShape(expression.expression, checker, callEdges, seenSymbols);
    return { ...inner, async: false };
  }
  if (ts.isCallExpression(expression)) {
    const edge = callEdges.get(expression);
    if (edge?.callee) {
      const callee = edge.callee;
      const channel = effectiveChannel(callee);
      return {
        channel,
        async: callee.async,
        failures: edge.instantiatedFailures ?? callee.failures,
        successType: callee.declaredShape.successType,
      };
    }
    if (edge?.foreign && edge.foreign.kind !== "never" && !edge.authoredBoundary) {
      const original = shapeOfType(checker.getTypeAtLocation(expression), checker);
      const failures = new Set<string>();
      addForeignFailures(failures, edge.foreign);
      return { channel: "result", async: edge.foreign.async, failures, successType: original.successType };
    }
  }
  if (ts.isIdentifier(expression)) {
    const symbol = unalias(checker.getSymbolAtLocation(expression), checker);
    if (symbol && !seenSymbols.has(symbol)) {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.find(ts.isVariableDeclaration);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        seenSymbols.add(symbol);
        return semanticExpressionShape(declaration.initializer, checker, callEdges, seenSymbols);
      }
    }
  }
  return shapeOfType(checker.getTypeAtLocation(expression), checker);
}

export function expressionShape(expression: ts.Expression, model: SemanticModel): TypeShape {
  return semanticExpressionShape(expression, model.checker, model.callEdges);
}

export function isResultPropagationExpression(
  expression: ts.NonNullExpression,
  model: SemanticModel,
): boolean {
  return isResultPropagation(expression, model.checker, model.callEdges);
}

/**
 * Postfix `!` propagates only from a `Result` operand.
 *
 * `Promise<Result<A, E>>` is not one: compatibility.mdx locks "postfix `!`
 * requires a `Result` operand", and type-system.mdx locks that `await` is what
 * removes the Promise layer. `(await lookup(k))!` is the spelling that works;
 * `lookup(k)!` is a non-Result operand and is refused with SMITHERS1207, the
 * same way every other non-Result operand is.
 */
function isResultPropagation(
  expression: ts.NonNullExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  const shape = semanticExpressionShape(expression.expression, checker, callEdges);
  return shape.channel.startsWith("result") && !shape.async;
}

function isRetiredResultUnwrap(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  const selection = calleeSelection(call);
  if (!selection || selection.name !== "unwrap" || call.arguments.length !== 0) return false;
  return semanticExpressionShape(selection.receiver, checker, callEdges).channel.startsWith("result");
}

function isExpectSyntax(call: ts.CallExpression): boolean {
  return calleeSelection(call)?.name === "expect";
}

/** @internal The receiver of an `expect` call, for the lowering pass. */
export function expectReceiver(call: ts.CallExpression): ts.Expression | undefined {
  return isExpectSyntax(call) ? calleeSelection(call)!.receiver : undefined;
}

function isResultExpectCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  const selection = calleeSelection(call);
  if (!selection || selection.name !== "expect") return false;
  return semanticExpressionShape(selection.receiver, checker, callEdges).channel.startsWith("result");
}

export function isResultExpectExpression(call: ts.CallExpression, model: SemanticModel): boolean {
  return isResultExpectCall(call, model.checker, model.callEdges);
}

/** An authored `Result.try(...)` / `Result.tryPromise(...)` call on the prelude `Result` value. */
function isPreludeResultBoundaryCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call);
  if (!selection) return false;
  const method = selection.name;
  if (method !== "try" && method !== "tryPromise") return false;
  const receiver = selection.receiver;
  if (!ts.isIdentifier(receiver) || receiver.text !== "Result") return false;
  const symbol = unalias(checker.getSymbolAtLocation(receiver), checker);
  return Boolean(symbol?.declarations?.some((declaration) => isCompilerPrelude(declaration.getSourceFile())));
}

/** The inline callback whose body an authored `Result.try`/`tryPromise` boundary owns. */
function isAuthoredResultBoundaryBody(node: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  const parent = node.parent;
  return ts.isCallExpression(parent) && parent.arguments[0] === node &&
    isPreludeResultBoundaryCall(parent, checker);
}

type ProducedKind = "plain" | "result" | "promise" | "promise-result";

function producedKind(expression: ts.Expression, checker: ts.TypeChecker, edges: ReadonlyMap<ts.CallExpression, CallEdge>): ProducedKind {
  const shape = semanticExpressionShape(expression, checker, edges);
  if (shape.async) return shape.channel.startsWith("result") ? "promise-result" : "promise";
  return shape.channel.startsWith("result") ? "result" : "plain";
}

function checkMustConsume(
  sourceFile: ts.SourceFile,
  functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const references = collectReferences(sourceFile, checker);
  const variableChecked = new Set<ts.Symbol>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const kind = producedKind(node, checker, callEdges);
      if (kind !== "plain" && !producerConsumed(node, kind, checker, callEdges, references)) {
        diagnostics.push(at(node, sourceFile, kind === "result" ? "SMITHERS1301" : "SMITHERS1402",
          kind === "result"
            ? "Result value is not consumed; return, match, transform, inspect, or propagate it with postfix !"
            : "started Promise is not consumed with await, return, or an awaited recognized combinator"));
      }
    }
    if (ts.isNewExpression(node) && isPromiseType(checker.getTypeAtLocation(node), checker)) {
      if (!producerConsumed(node, "promise", checker, callEdges, references)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1402", "started Promise is not consumed with await, return, or an awaited recognized combinator"));
      }
    }
    if (ts.isAwaitExpression(node)) {
      const awaited = semanticExpressionShape(node.expression, checker, callEdges);
      if (awaited.async && awaited.channel.startsWith("result") &&
        !producerConsumed(node, "result", checker, callEdges, references)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1301", "await removes only Promise; the resulting Result must still be returned, matched, transformed, inspected, or propagated with postfix !"));
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
      const kind = producedKind(node.initializer, checker, callEdges);
      if (symbol && kind !== "plain" && !variableChecked.has(symbol)) {
        variableChecked.add(symbol);
        const usages = (references.get(symbol) ?? []).filter((identifier) => identifier !== node.name);
        const consumed = usages.some((identifier) => referenceConsumes(identifier, kind, checker, callEdges, references));
        if (!consumed) {
          diagnostics.push(at(node.name, sourceFile, kind === "result" ? "SMITHERS1302" : "SMITHERS1403",
            kind === "result"
              ? `Result '${node.name.text}' is never consumed`
              : `Promise '${node.name.text}' is never consumed with await or return`));
        }
      }
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
      const kind = producedKind(node.name, checker, callEdges);
      const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
      if (symbol && kind === "result" && !variableChecked.has(symbol)) {
        variableChecked.add(symbol);
        const usages = (references.get(symbol) ?? []).filter((identifier) => identifier !== node.name);
        if (!usages.some((identifier) => referenceConsumes(identifier, kind, checker, callEdges, references))) {
          diagnostics.push(at(node.name, sourceFile, "SMITHERS1302", `Result parameter '${node.name.text}' is never consumed`));
        }
      }
    }
    if (ts.isNonNullExpression(node)) {
      const owner = nearestFunction(node);
      const info = owner && functionByNode.get(owner);
      if (isResultPropagation(node, checker, callEdges)) {
        if (!info || (!info.declaredShape.channel.startsWith("result") && info.failures.size === 0)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1202", "postfix ! propagation requires an enclosing Result-returning function"));
        } else if (isInRepeatedLoopHeader(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1703", "postfix ! propagation in a loop condition, incrementor, or iteration expression needs per-iteration control-flow lowering; assign before the loop or propagate inside its body"));
        } else if (!isSafePropagationPlacement(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1204", "postfix ! in this expression would require control-flow-aware evaluation-order rewriting; assign the Result to a local and propagate it in a simple statement"));
        }
      } else {
        diagnostics.push(at(
          node,
          sourceFile,
          "SMITHERS1207",
          "postfix ! requires a Result operand; TypeScript non-null assertions are unavailable in .sm",
        ));
      }
    }
    if (ts.isCallExpression(node) && isRetiredResultUnwrap(node, checker, callEdges)) {
      diagnostics.push(at(
        node,
        sourceFile,
        "SMITHERS1206",
        "Result.unwrap() is no longer the propagation spelling; use postfix !",
      ));
    }
    if (ts.isCallExpression(node) && isResultExpectCall(node, checker, callEdges)) {
      if (isInRepeatedLoopHeader(node)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1703", "Result.expect() in a loop condition, incrementor, or iteration expression needs per-iteration control-flow lowering; assign before the loop or expect inside its body"));
      } else if (!isSafePropagationPlacement(node)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1204", "Result.expect() in this expression would require control-flow-aware evaluation-order rewriting; assign the Result to a local and expect it in a simple statement"));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectReferences(sourceFile: ts.SourceFile, checker: ts.TypeChecker): Map<ts.Symbol, ts.Identifier[]> {
  const result = new Map<ts.Symbol, ts.Identifier[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = unalias(checker.getSymbolAtLocation(node), checker);
      if (symbol) {
        const values = result.get(symbol) ?? [];
        values.push(node);
        result.set(symbol, values);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

/**
 * The container literal a value in `current` is STORED INTO, or undefined.
 *
 * Array and tuple elements, spreads of either kind, and object-literal property
 * values. A shorthand property (`{ r }`) is an identifier reference and reaches
 * the same place through `referenceConsumes`.
 */
function containerLiteralFor(current: ts.Node, parent: ts.Node): ts.Expression | undefined {
  if (ts.isArrayLiteralExpression(parent)) return parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === current &&
    ts.isObjectLiteralExpression(parent.parent)) return parent.parent;
  if (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent)) return parent.parent;
  if (ts.isSpreadAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) return parent.parent;
  return undefined;
}

/**
 * Whether a type still carries a must-consume channel — a Result or a started
 * Promise — somewhere inside it.
 *
 * This is what decides whether a container literal really STORES the value it
 * was handed. `return [make("ada")]` from a `Result<number, Missing>[]`
 * function stores it: the array's own type carries the channel, so ownership
 * moves to the array. `return [shout("hello")]` from a `string[]` function
 * does NOT: `shout` is an untrusted foreign call the compiler LIFTS to
 * `Result<string, Panic>` while its declaration still says `string`, so the
 * array's type is `string[]` and the checked failure is dropped on the way in.
 * That is a discard however it is spelled, and it stays SMITHERS1301
 * (09-foreign-calls/foreign-module-without-a-trust-marker pins it).
 *
 * Imprecision here is fail-closed in both directions: a false answer refuses at
 * the element, a true answer keeps the obligation alive and refuses unless a
 * real consumption follows.
 */
function holdsProducedChannel(type: ts.Type, checker: ts.TypeChecker, depth = 0): boolean {
  if (depth > 3) return false;
  if (type.isUnion() || type.isIntersection()) {
    return type.types.some((member) => holdsProducedChannel(member, checker, depth + 1));
  }
  const shape = shapeOfType(type, checker);
  if (shape.channel.startsWith("result") || shape.async) return true;
  if (checker.isArrayType(type) || checker.isTupleType(type) || checker.isArrayLikeType(type)) {
    return typeArguments(type, checker).some((argument) => holdsProducedChannel(argument, checker, depth + 1));
  }
  // Only object LITERAL shapes are scanned member by member. A nominal class
  // or interface instance is never the container literal this test is asked
  // about, and walking every member of one (`Console`, a DOM type) would cost
  // far more than the answer is worth. Not scanning it answers "no", which is
  // the refusing direction.
  if ((type.flags & ts.TypeFlags.Object) === 0) return false;
  if (((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous) === 0) return false;
  return checker.getPropertiesOfType(type)
    .some((property) => holdsProducedChannel(checker.getTypeOfSymbol(property), checker, depth + 1));
}

/** Shared state for one ownership walk. */
interface OwnershipWalk {
  readonly kind: ProducedKind;
  readonly checker: ts.TypeChecker;
  readonly edges: ReadonlyMap<ts.CallExpression, CallEdge>;
  /** True for the walk that starts at the producer, false for a reference. */
  readonly fromProducer: boolean;
  /** Bindings already followed, so a self-referential chain terminates. */
  readonly seen: Set<ts.Symbol>;
  /** Identifier occurrences by symbol; absent when the caller has no index. */
  readonly references?: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>;
}

/**
 * Does the obligation on a produced Result/Promise get discharged from here?
 *
 * The specification's rule is that a Result MUST NOT be *silently discarded*
 * "without returning, matching, transforming, inspecting, or unwrapping it"
 * (failures.mdx) and that "an ignored Result MUST be a compile error"
 * (type-system.mdx). Neither forwarding a value nor storing it is a discard, so
 * the walk climbs to whichever enclosing value the produced value BECOMES and
 * lets that value's position answer. Two kinds of climb:
 *
 *   FORWARDING — the enclosing expression IS the value: parentheses,
 *   `as`/`satisfies`/`<T>` assertions, either branch of a conditional, and the
 *   concise body of an arrow (which is a `return` spelled without the keyword;
 *   the braced form has always discharged here). Kind and obligation unchanged.
 *
 *   STORAGE — the value is placed into a container literal that really carries
 *   the channel (`holdsProducedChannel`). Ownership moves to the container,
 *   which is a COLLECTION of Results rather than a Result, so `!` and the
 *   receiver consumers no longer apply to it; `collection` records the
 *   transfer and `collectionConsumed` decides the collection's fate. This is
 *   what specification compatibility.mdx promises when it says `arr[i]!`
 *   "compiles only when `arr` holds Results": building the array is not the
 *   discard, and reading an element back out with `!` is the consumption.
 *
 * A stored collection does NOT escape by being bound: `bindingConsumes` walks
 * the binding's own references, so `const arr = [make()]` that is never
 * consumed is still refused at the element positions, exactly as before.
 */
function ownershipConsumed(start: ts.Node, held: boolean, walk: OwnershipWalk): boolean {
  const { kind, checker, edges } = walk;
  let current: ts.Node = start;
  let collection = held;
  for (;;) {
    const parent = current.parent;
    if (!parent) return false;

    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) || ts.isTypeAssertionExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && (parent.whenTrue === current || parent.whenFalse === current)) {
      current = parent;
      continue;
    }
    if (ts.isNonNullExpression(parent) && parent.expression === current) {
      // `!` discharges a Result by extracting from it. On anything else — a
      // collection, or an un-awaited `Promise<Result<…>>` — it extracts
      // nothing (SMITHERS1207 reports that separately), so the value passes
      // through unchanged and its position still has to answer.
      if (!collection && kind === "result") return true;
      current = parent;
      continue;
    }

    // Storage transfers ownership only when the container really stores the
    // channel; see `holdsProducedChannel`. When it does not, nothing moved and
    // the ordinary rules below decide, exactly as they did before this walk
    // understood containers at all.
    const container = containerLiteralFor(current, parent);
    if (container && holdsProducedChannel(checker.getTypeAtLocation(container), checker)) {
      current = container;
      collection = true;
      continue;
    }

    if (ts.isReturnStatement(parent)) return true;
    // A concise arrow body is a return: the obligation lands on this
    // function's contract and therefore on its callers.
    if (isSupportedFunctionLike(parent) && parent.body === current) return true;

    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      if (collection) return bindingConsumes(parent, walk);
      // Binding a Result names it; the binding's own SMITHERS1302 check then
      // owns it. Re-binding a Result THROUGH a reference discharges nothing,
      // which is why only the producer walk stops here.
      if (walk.fromProducer) return true;
    } else if (collection) {
      return collectionConsumed(current, parent, walk);
    } else if (kind === "promise" || kind === "promise-result") {
      if (ts.isAwaitExpression(parent)) return true;
      if (isInsideRecognizedPromiseCombinator(current, checker)) {
        return combinatorConsumed(current, checker, edges, walk.references);
      }
    } else if (kind === "result") {
      if (walk.fromProducer && memberSelection(parent)?.receiver === current &&
        ts.isCallExpression(parent.parent) && parent.parent.expression === parent &&
        isRetiredResultUnwrap(parent.parent, checker, edges)) return true;
      if (isConsumedResultReceiver(current, parent)) return true;
      if (isInsideResultAll(current, checker)) return true;
    }
    return false;
  }
}

/**
 * A collection of Results reached a binding: the obligation follows the
 * binding, so at least one of its references must consume it.
 *
 * A destructuring pattern scatters the elements into bindings this analysis
 * does not track, so the obligation stays where it is rather than being
 * silently released.
 */
function bindingConsumes(declaration: ts.VariableDeclaration, walk: OwnershipWalk): boolean {
  if (!ts.isIdentifier(declaration.name) || !walk.references) return false;
  const symbol = unalias(walk.checker.getSymbolAtLocation(declaration.name), walk.checker);
  if (!symbol || walk.seen.has(symbol)) return false;
  walk.seen.add(symbol);
  return (walk.references.get(symbol) ?? []).some((identifier) =>
    identifier !== declaration.name && ownershipConsumed(identifier, true, { ...walk, fromProducer: false }));
}

/**
 * The discharge surface for a COLLECTION that holds Results or Promises.
 *
 * Deliberately narrow: only the sites the specification settles. A recognized
 * collection combinator (`Result.all`, the ambient `Promise` combinators) owns
 * everything handed to it, and reading a held value back out puts the
 * obligation onto the value that was read — which is exactly the `arr[i]!`
 * spelling compatibility.mdx promises compiles. Everything else — `arr.length`,
 * `for (const r of arr)`, handing the array to a user function — still refuses,
 * unchanged from before this rule existed, because no specification sentence
 * says what consuming a collection means at those sites.
 */
function collectionConsumed(current: ts.Node, parent: ts.Node, walk: OwnershipWalk): boolean {
  const { checker, edges } = walk;
  if (isInsideResultAll(current, checker)) return true;
  if (isInsideRecognizedPromiseCombinator(current, checker)) {
    return combinatorConsumed(current, checker, edges, walk.references);
  }
  if ((!ts.isPropertyAccessExpression(parent) && !ts.isElementAccessExpression(parent)) ||
    parent.expression !== current) return false;
  const shape = semanticExpressionShape(parent, checker, edges);
  if (shape.channel.startsWith("result")) {
    const kind: ProducedKind = shape.async ? "promise-result" : "result";
    return ownershipConsumed(parent, false, { ...walk, kind, fromProducer: false });
  }
  return holdsProducedChannel(checker.getTypeAtLocation(parent), checker) &&
    ownershipConsumed(parent, true, walk);
}

function producerConsumed(
  expression: ts.Expression,
  kind: ProducedKind,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<ts.CallExpression, CallEdge>,
  references?: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>,
): boolean {
  return ownershipConsumed(expression, false,
    { kind, checker, edges, fromProducer: true, seen: new Set(), references });
}

function referenceConsumes(
  identifier: ts.Identifier,
  kind: ProducedKind,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<ts.CallExpression, CallEdge>,
  references?: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>,
): boolean {
  return ownershipConsumed(identifier, false,
    { kind, checker, edges, fromProducer: false, seen: new Set(), references });
}

/**
 * The locked receiver surface that discharges a Result ownership obligation.
 *
 * Matched by MEMBER SPELLING, and soundly so, because every caller has already
 * established that the RECEIVER is a compiler-owned Result-channel value. The
 * only question left is which member of a value that is already the compiler's
 * was selected. Contrast `isInsideResultAll`, where the receiver is not
 * established and the spelling test was a real fail-open.
 *
 * Declaration identity is not available here, unlike in the Go backend, which
 * recognizes this surface AFTER lowering where the checker sees a real
 * `Result<A, E>`. This analyzer runs on the AUTHORED `.sm` source, where a
 * lifted call still carries its authored success type, and a strict test
 * demonstrably reports false SMITHERS1301s in two different ways:
 *
 *   - the member resolves NOWHERE — `helper("x").unwrap()` on a foreign
 *     JavaScript import whose declared return type is `number`; and, worse,
 *   - the member resolves to the WRONG declaration — for an unannotated
 *     function inferred as `Result<string, Missing>`, `lookup("ada").match(...)`
 *     resolves to `String.prototype.match` in lib.es5.d.ts, a perfectly real
 *     symbol that is simply not the compiler's.
 *
 * Both are ordinary authored programs; the second is a conformance case. So the
 * receiver surface stays on spelling, deliberately, and the security property
 * comes from the receiver precondition rather than from the member name.
 */
const RESULT_CONSUMERS = new Set([
  "isOk", "isError", "match", "map", "mapError", "andThen", "recover", "tap", "tapError", "unwrapOr", "expect",
]);

// A callback that RETURNS a Result used to need its own recognized-combinator
// list here, because only `andThen`/`recover` flatten what their callback
// returns. That list only ever governed the CONCISE arrow spelling: the braced
// `(v) => { return lookup(v) }` has always discharged through the ordinary
// return rule, in every callback position, so the two spellings of the same
// function disagreed. The ownership walk now treats a concise body as the
// return it is, which is what makes them agree. The residual — returning an
// unconsumed Result into a callback whose contract discards it, such as
// `forEach` — is unchanged by that, predates it in the braced spelling, and is
// a rule about `return` rather than about arrow syntax.

/**
 * Members of the compiler-owned `Result` namespace value that discharge an
 * obligation for the Results passed to them. `try`/`tryPromise` are excluded:
 * they ADOPT a throw scope rather than consuming an already-computed Result.
 */
const RESULT_NAMESPACE_CONSUMERS = new Set(["all"]);

/**
 * The prelude declaration a member name resolves to, or undefined when the
 * member is not declared by this analyzer's own prelude. Authority is checker
 * symbol identity, so a user object with a same-spelled member resolves to its
 * own declaration and can never stand in for a compiler-owned combinator.
 */
function preludeMemberDeclaration(name: ts.Node, checker: ts.TypeChecker): ts.MethodSignature | undefined {
  const declaration = unalias(checker.getSymbolAtLocation(name), checker)?.declarations
    ?.find((candidate) => isCompilerPrelude(candidate.getSourceFile()));
  return declaration !== undefined && ts.isMethodSignature(declaration) && ts.isIdentifier(declaration.name)
    ? declaration
    : undefined;
}

/**
 * A member of the prelude's `Result` namespace value (`declare const Result`).
 * A user object with an `all` member never matches here.
 */
function isPreludeResultNamespaceMember(
  name: ts.Node,
  checker: ts.TypeChecker,
  members: ReadonlySet<string>,
): boolean {
  const declaration = preludeMemberDeclaration(name, checker);
  if (declaration === undefined || !ts.isTypeLiteralNode(declaration.parent)) return false;
  const owner = declaration.parent.parent;
  return ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name) && owner.name.text === "Result" &&
    members.has((declaration.name as ts.Identifier).text);
}

function isConsumedResultReceiver(current: ts.Node, parent: ts.Node): boolean {
  const selection = memberSelection(parent);
  return selection !== undefined && selection.receiver === current &&
    RESULT_CONSUMERS.has(selection.name) &&
    ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
}

/**
 * An argument of the compiler-owned `Result.all(...)`.
 *
 * Resolved to the prelude's own declaration, never to the spelling `Result`.
 * This is the one discharge site with NO receiver precondition — nothing else
 * has established that the callee is the compiler's — so a user's
 * `const Result = { all: (x) => x }` previously satisfied the obligation and an
 * unconsumed Result escaped with no SMITHERS1301/SMITHERS1302. The Go backend
 * resolves the same site through `resultNamespaceCall`, i.e. prelude
 * declaration identity, and is correct.
 */
function isInsideResultAll(node: ts.Node, checker: ts.TypeChecker): boolean {
  let current = node;
  while (ts.isArrayLiteralExpression(current.parent) || ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(current as ts.Expression)) return false;
  const selection = calleeSelection(parent);
  return selection !== undefined &&
    isPreludeResultNamespaceMember(selection.nameNode, checker, RESULT_NAMESPACE_CONSUMERS);
}

/**
 * The ambient `Promise` global, resolved to its TypeScript library declaration.
 *
 * The same rule `isInsideResultAll` applies to the compiler's own `Result`
 * namespace, for the same reason: this is a discharge site with no receiver
 * precondition, so the spelling alone decided it. A local
 * `const Promise = { async all(values) { return values } }` shadows the global,
 * returns a real Promise — which defeats the `promisedType` test below on its
 * own — and previously discharged a must-consume Promise obligation.
 */
function isAmbientPromiseNamespace(node: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(node) || node.text !== "Promise") return false;
  return Boolean(unalias(checker.getSymbolAtLocation(node), checker)?.declarations
    ?.some((declaration) => isTypeScriptLibrary(declaration.getSourceFile())));
}

function isInsideRecognizedPromiseCombinator(node: ts.Node, checker: ts.TypeChecker): boolean {
  let current = node;
  while (ts.isArrayLiteralExpression(current.parent) || ts.isObjectLiteralExpression(current.parent) || ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(current as ts.Expression)) return false;
  const selection = calleeSelection(parent);
  if (!selection || !isAmbientPromiseNamespace(selection.receiver, checker)) return false;
  return ["all", "allSettled", "race", "any", "allKeyed", "allSettledKeyed"].includes(selection.name) &&
    Boolean(promisedType(checker.getTypeAtLocation(parent), checker));
}

function combinatorConsumed(
  node: ts.Node,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<ts.CallExpression, CallEdge>,
  references?: ReadonlyMap<ts.Symbol, readonly ts.Identifier[]>,
): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    const selection = ts.isCallExpression(current) ? calleeSelection(current) : undefined;
    if (selection && isAmbientPromiseNamespace(selection.receiver, checker)) {
      return producerConsumed(current as ts.CallExpression, "promise", checker, edges, references);
    }
    current = current.parent;
  }
  return false;
}

function isPromiseType(type: ts.Type, checker: ts.TypeChecker): boolean {
  return Boolean(promisedType(type, checker));
}

function isSafePropagationPlacement(expression: ts.Expression): boolean {
  let current: ts.Node = expression;
  while (current.parent && !ts.isStatement(current.parent) && !ts.isArrowFunction(current.parent)) {
    const parent = current.parent;
    if (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent) || ts.isAsExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }
    // The specification directly requires `result!?.member ?? fallback`.
    // Only the coalescing left operand is admitted here: hoisting from its
    // right operand would make conditional work unconditional, and admitting
    // other compound operators would settle the still-open precedence and
    // evaluation-order surface by accident.
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      parent.left === current) {
      current = parent;
      continue;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current &&
      ts.isVariableDeclarationList(parent.parent) && parent.parent.declarations.length === 1) {
      current = parent.parent;
      continue;
    }
    if (ts.isVariableDeclarationList(parent) && parent.declarations.length === 1) {
      current = parent;
      continue;
    }
    return false;
  }
  return true;
}

function isInRepeatedLoopHeader(node: ts.Node): boolean {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isForInStatement(parent) ||
      ts.isForOfStatement(parent)) {
      return current !== parent.statement;
    }
    if (ts.isForStatement(parent)) {
      // A for initializer runs once and can safely emit an outer prologue. The
      // condition and incrementor repeat and therefore cannot.
      return current !== parent.statement && current !== parent.initializer;
    }
    current = parent;
  }
  return false;
}

/**
 * Panic exits and postfix propagation lower to early `return` statements. An
 * enclosing JavaScript `try` with a `catch` clause would silently never see
 * them even though the authored text looks catchable, so those placements are
 * hard errors instead of silently dead catch paths.
 */
function checkJavaScriptCatchBoundaries(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  diagnostics: PendingDiagnostic[],
): void {
  const visit = (node: ts.Node, caughtByJavaScript: boolean): void => {
    if (node !== sourceFile && isSupportedFunctionLike(node)) {
      // A nested function is its own propagation owner; its early returns do
      // not bypass this catch clause.
      ts.forEachChild(node, (child) => visit(child, false));
      return;
    }
    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, caughtByJavaScript || Boolean(node.catchClause));
      if (node.catchClause) visit(node.catchClause.block, caughtByJavaScript);
      if (node.finallyBlock) visit(node.finallyBlock, caughtByJavaScript);
      return;
    }
    if (caughtByJavaScript && ts.isNonNullExpression(node) && isResultPropagation(node, checker, callEdges)) {
      diagnostics.push(at(
        node,
        sourceFile,
        "SMITHERS1205",
        "postfix ! propagation inside a JavaScript try statement with a catch clause is not lowered because its early return would silently bypass the catch handler; move the propagation point outside the try or consume the value explicitly",
      ));
    }
    if (caughtByJavaScript && ts.isCallExpression(node)) {
      const construct = callEdges.get(node)?.panicExit
        ? "panic(...)"
        : isResultExpectCall(node, checker, callEdges)
          ? "Result.expect()"
          : undefined;
      if (construct) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1205", `${construct} inside a JavaScript try statement with a catch clause is not lowered because its early-return propagation would silently bypass the catch handler; move the propagation point outside the try or consume the value explicitly`));
      }
    }
    ts.forEachChild(node, (child) => visit(child, caughtByJavaScript));
  };
  visit(sourceFile, false);
}

function checkAuthoredApis(sourceFile: ts.SourceFile, checker: ts.TypeChecker, diagnostics: PendingDiagnostic[]): void {
  const visit = (node: ts.Node): void => {
    const selection = memberSelection(node);
    if (selection && ts.isIdentifier(selection.receiver)) {
      const owner = selection.receiver.text;
      if (owner === "Result" && ["ok", "err", "error", "success"].includes(selection.name)) {
        const symbol = checker.getSymbolAtLocation(selection.receiver);
        if (!symbol || symbol.declarations?.some((declaration) => isCompilerPrelude(declaration.getSourceFile()))) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1201", `${owner}.${selection.name} is a compiler hook, not an author-facing constructor; use ordinary return/throw lifting`));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function isErrorMatchCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const selection = calleeSelection(call);
  if (!selection || !["match", "matchPartial"].includes(selection.name)) return false;
  return isErrorType(checker.getTypeAtLocation(selection.receiver), checker);
}

/**
 * The row identity an `Error.match` case label selects. The label is an
 * ordinary in-scope value binding, so it is resolved at the handler object's
 * location; an unresolvable label keeps its authored text and is reported by
 * the ordinary missing/extra-case rules.
 */
function errorCaseRowName(label: ts.Identifier, location: ts.Node, checker: ts.TypeChecker): string {
  const symbol = unalias(checker.resolveName(label.text, location, ts.SymbolFlags.Value, false), checker);
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  if (!declaration?.name) return label.text;
  return rowNameForSymbol(
    unalias(checker.getSymbolAtLocation(declaration.name), checker),
    declaration.name.text,
    checker,
  );
}

function checkErrorMatches(sourceFile: ts.SourceFile, checker: ts.TypeChecker, diagnostics: PendingDiagnostic[]): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isErrorMatchCall(node, checker)) {
      const selected = memberSelection(node.expression)!.name;
      const partial = selected === "matchPartial";
      const handlers = node.arguments[0];
      if (!handlers || !ts.isObjectLiteralExpression(handlers)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1251", `Error.${selected} requires an object literal so nominal cases can be checked and lowered`));
      } else {
        const actual = new Set<string>();
        let valid = true;
        for (const member of handlers.properties) {
          if ((ts.isPropertyAssignment(member) || ts.isMethodDeclaration(member)) && member.name &&
            ts.isIdentifier(member.name)) {
            // A case label is the in-scope binding of the Error class, which
            // may be an import alias. Compare nominal row identities, not the
            // authored spelling, so module-qualified rows stay exhaustive.
            actual.add(errorCaseRowName(member.name, handlers, checker));
          } else {
            valid = false;
          }
        }
        if (!valid) diagnostics.push(at(handlers, sourceFile, "SMITHERS1252", "Error match cases must use static Error class names and function handlers"));
        if (!partial) {
          const expected = errorNamesOfType(
            checker.getTypeAtLocation(memberSelection(node.expression)!.receiver), checker);
          const missing = difference(expected, actual);
          const extra = difference(actual, expected);
          if (missing.size > 0) diagnostics.push(at(handlers, sourceFile, "SMITHERS1253", `Error.match is not exhaustive; missing ${formatSet(missing)}`));
          if (extra.size > 0) diagnostics.push(at(handlers, sourceFile, "SMITHERS1254", `Error.match has cases outside the checked union: ${formatSet(extra)}`));
        } else if (node.arguments.length !== 2) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1255", "Error.matchPartial requires an explicit fallback(error) callback as its second argument"));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function checkDuplicateErrorNames(sourceFile: ts.SourceFile, checker: ts.TypeChecker, diagnostics: PendingDiagnostic[]): void {
  const seen = new Map<string, ts.ClassDeclaration>();
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name && node.heritageClauses?.length &&
      isErrorType(checker.getTypeAtLocation(node.name), checker)) {
      const prior = seen.get(node.name.text);
      if (prior) {
        diagnostics.push(at(node.name, sourceFile, "SMITHERS1150", `duplicate Error class name '${node.name.text}' cannot receive a stable module-local identity in this POC`));
      } else {
        seen.set(node.name.text, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

interface ScannedToken {
  readonly kind: ts.SyntaxKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function startsRetiredStatement(previous: string | undefined): boolean {
  return previous === undefined || previous === "{" || previous === "}" || previous === ";" || previous === ":";
}

function startsRetiredValue(tokens: readonly ScannedToken[], index: number): boolean {
  return ["=", "return", "[", "=>", "?", "+", "-", "*", "/", "%", "&&", "||", "??"]
    .includes(tokens[index - 1]?.text ?? "");
}

function isRetiredValueLabel(tokens: readonly ScannedToken[], index: number): boolean {
  if (tokens[index]?.kind !== ts.SyntaxKind.Identifier || tokens[index + 1]?.text !== ":") return false;
  const next = tokens[index + 2]?.text;
  return startsRetiredValue(tokens, index) &&
    (next === "{" || next === "while" || next === "for" || next === "do");
}

function matchingTokenBackward(
  tokens: readonly ScannedToken[],
  closeIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = closeIndex; index >= 0; index--) {
    if (tokens[index]?.text === close) depth++;
    if (tokens[index]?.text === open && --depth === 0) return index;
  }
  return -1;
}

/** Recognize `label: while/for (...) { ... } else value` in statement position. */
function isRetiredLoopElse(tokens: readonly ScannedToken[], elseIndex: number): boolean {
  if (tokens[elseIndex]?.text !== "else" || tokens[elseIndex - 1]?.text !== "}") return false;
  const bodyOpen = matchingTokenBackward(tokens, elseIndex - 1, "{", "}");
  if (bodyOpen < 2 || tokens[bodyOpen - 1]?.text !== ")") return false;
  const headerOpen = matchingTokenBackward(tokens, bodyOpen - 1, "(", ")");
  if (headerOpen < 3 || (tokens[headerOpen - 1]?.text !== "while" && tokens[headerOpen - 1]?.text !== "for")) {
    return false;
  }
  const label = headerOpen - 3;
  return tokens[headerOpen - 2]?.text === ":" && tokens[label]?.kind === ts.SyntaxKind.Identifier &&
    !isRetiredValueLabel(tokens, label);
}

function checkRemovedAndUnsupportedSyntax(
  source: string,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  recovery: RecoveredSource,
  diagnostics: PendingDiagnostic[],
): void {
  const tokens = scanSource(source);
  const explicitOffsets: number[] = [...recovery.rejectedStarts];
  const removed = (token: ScannedToken, message: string): void => {
    explicitOffsets.push(token.start);
    diagnostics.push({ severity: "error", code: "SMITHERS1001", message, start: token.start });
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (token.text === "error" && next?.kind === ts.SyntaxKind.Identifier && tokens[index + 2]?.text === "{" &&
      !hasLineBreakBetween(source, token, next)) {
      // `error Name {` is a declaration header written on one line. Two
      // adjacent identifiers with no line terminator between them are never
      // legal TypeScript, so this cannot claim an ASI-separated statement pair
      // such as `error` / `Missing` / `{ ... }`.
      removed(token, "the historical `error Name {}` declaration was removed; declare an ordinary `class Name extends Error`");
    }
    if ((token.text === "throws" || token.text === "uses") && previous?.text !== "." &&
      !isMemberNameOccurrence(tokens, index) && endsReturnType(previous) &&
      next?.kind === ts.SyntaxKind.Identifier && isBetweenFunctionParametersAndBody(tokens, index)) {
      // The retired clause is a suffix on a complete return type and names a
      // right operand (`throws Missing`, `uses Clock`). A type spelled `uses`
      // inside type arguments or a union — `Array<uses>`, `string | throws` —
      // has neither shape.
      removed(token, token.text === "throws"
        ? "the `throws` row grammar was removed; declare Result<A, E> in public contracts and let local functions infer it"
        : "the named `uses` grammar was removed; extend Context and call Capability.context()");
    }
    if (token.text === "!" && previous?.text === ":" &&
      (tokens[index - 2]?.text === ")" || next?.text === "?" ||
        TYPE_ONLY_KEYWORDS.has(next?.text ?? ""))) {
      // A return-type colon (`): !string`), the `!?T` pair, or a type-keyword
      // operand. Without those the `!` is an ordinary logical negation in a
      // value position — `{ ok: !failed }` and `flag ? a : !b` both put a `!`
      // directly after a colon and neither is retired grammar.
      removed(token, "the `!T` return marker was removed; use Result<T, E>");
    }
    if (token.text === "!" && next?.text === ":" &&
      (previous?.kind === ts.SyntaxKind.Identifier || previous?.kind === ts.SyntaxKind.PrivateIdentifier)) {
      removed(token, "the definite-assignment assertion x!: T is unavailable in .sm; initialize or narrow the binding explicitly");
    }
    if (token.text === "?" && (previous?.text === ":" ||
      (previous?.text === "!" && tokens[index - 2]?.text === ":")) && next && /^[A-Za-z_$]/.test(next.text)) {
      removed(token, "the `?T` type grammar was removed; use T | undefined");
    }
    if (token.text === "orelse" && previous?.text !== "." &&
      !isMemberNameOccurrence(tokens, index) &&
      tokenEndsExpression(previous?.kind) && beginsOperand(next)) {
      // `orelse` is a binary operator, so it needs both operands. `orelse` is
      // also an ordinary identifier: `const orelse = 1`, `{ orelse }`,
      // `{ orelse: 7 }`, `String(orelse)`, and `orelse()` are all legal.
      removed(token, "the `orelse` operator was removed; use nullish coalescing or ordinary narrowing");
    }
    if (token.text === "." && next?.text === "?") {
      removed(token, "the `.?` postfix operator was removed; use optional chaining or ordinary narrowing");
    }
    if (token.text === "try" && next?.text !== "{" &&
      !isMemberNameOccurrence(tokens, index) && beginsOperand(next)) {
      // The retired prefix marker takes a right operand. `try` is a reserved
      // word, so every other legal spelling is a property name: the public
      // `Result.try(...)` API, `{ try: adapt }`, `{ try() {} }`, and
      // `interface I { try: T }`.
      removed(token, "the prefix `try` propagation marker was removed; use postfix !");
    }
    if (token.text === "catch" && previous?.text !== "}" &&
      !isMemberNameOccurrence(tokens, index) &&
      tokenEndsExpression(previous?.kind) && beginsOperand(next)) {
      // The retired postfix form takes both operands: `compute(k) catch alt`.
      // Statement-form `try { } catch { }` has no left operand, and a Promise
      // `.catch(...)` member access is rejected by the Promise discipline
      // pass, not misreported as retired grammar.
      removed(token, "the postfix catch expression was removed; recover with Result.match() or recover()");
    }
    if ((token.text === "defer" || token.text === "errdefer") &&
      startsRetiredStatement(previous?.text) && next?.kind === ts.SyntaxKind.Identifier) {
      removed(token, token.text === "defer"
        ? "the defer statement was withdrawn; use an explicit resource-management using declaration"
        : "the errdefer statement was withdrawn; write cleanup explicitly in the Result failure path");
    }
    if (token.text === "break" && next?.text === ":" &&
      tokens[index + 2]?.kind === ts.SyntaxKind.Identifier && beginsOperand(tokens[index + 3])) {
      removed(token, "the break :label value grammar was withdrawn; labeled breaks do not carry values");
    }
    if (isRetiredLoopElse(tokens, index)) {
      removed(token, "the loop else completion grammar was withdrawn; loops retain TypeScript statement behavior");
    }
    if ((token.text === "if" || token.text === "switch") && startsRetiredValue(tokens, index)) {
      removed(token, `expression-position ${token.text} grammar was withdrawn; use existing TypeScript expressions`);
    }
    if (isRetiredValueLabel(tokens, index)) {
      removed(token, "expression-position labeled block and loop grammar was withdrawn; labels remain statements");
    }
  }

  // Switch clauses are colon-delimited, exactly as in TypeScript. The
  // specification's Switch section requires the TypeScript `switch`/`case`/
  // `default` grammar and states that Smithers MUST NOT introduce a separate
  // arrow-arm switch grammar, so `case x => v` is not a Smithers form in any
  // position — and neither is a clause with no separator at all.
  //
  // TypeScript's parser recovers both by pretending the colon was written,
  // leaving the recovered clause indistinguishable from `case x: v` in the
  // tree. Re-read the separator gap so malformed ordinary switches cannot
  // silently pass through parser recovery.
  const visitSwitchClauseGrammar = (node: ts.Node): void => {
    if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      const separator = clauseSeparatorDefect(node, source, sourceFile);
      if (separator) {
        explicitOffsets.push(separator.start);
        diagnostics.push({
          severity: "error",
          code: "SMITHERS1000",
          message: "source does not match the supported .sm grammar: " + (separator.arrow
            ? "switch clauses are colon-delimited exactly as in TypeScript; there is no arrow-arm switch form"
            : "a switch `case`/`default` clause must be delimited by `:`"),
          start: separator.start,
        });
      }
    }
    ts.forEachChild(node, visitSwitchClauseGrammar);
  };
  visitSwitchClauseGrammar(sourceFile);

  const parseFailure = parseDiagnosticsFailure(sourceFile);
  if (parseFailure) diagnostics.push(parseFailure);
  for (const diagnostic of internalParseDiagnostics(sourceFile) ?? []) {
    const start = diagnostic.start ?? 0;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (explicitOffsets.some((offset) => Math.abs(offset - start) < 48)) continue;
    diagnostics.push({
      severity: "error",
      code: "SMITHERS1000",
      message: `source does not match the supported .sm grammar: ${message}`,
      start,
    });
  }

  const visitUnsupportedAst = (node: ts.Node): void => {
    if (ts.isClassStaticBlockDeclaration(node)) {
      diagnostics.push(at(node, sourceFile, "SMITHERS1107", "class `static {}` initialization blocks execute outside every checked function channel and are not analyzed or lowered by this POC; use static field initializers or an explicit checked function"));
    }
    ts.forEachChild(node, visitUnsupportedAst);
  };
  visitUnsupportedAst(sourceFile);

  checkHostGlobals(sourceFile, checker, diagnostics);
  checkForeignModuleInitializers(sourceFile, checker, diagnostics);
}

/**
 * Where a switch clause's `:` should have been, when something else is written
 * there instead; `undefined` for every clause the grammar accepts.
 *
 * TypeScript's parser reports "':' expected." and then continues as though the
 * colon had been written, so neither the arrow of `case x => v` nor the absent
 * separator of `case x v` survives in any node of the tree. Only a rescan of
 * the gap between the clause header and its first statement recovers them.
 * Scanning (rather than searching the text) is what keeps `case x /* => *\/: v`
 * an ordinary clause, and taking only the FIRST significant token is what keeps
 * an arrow function inside a clause value — `case x: (() => v)()` — and an
 * arrow type in a nearby annotation out of the rule.
 */
function clauseSeparatorDefect(
  clause: ts.CaseOrDefaultClause,
  source: string,
  sourceFile: ts.SourceFile,
): { readonly start: number; readonly arrow: boolean } | undefined {
  const headerEnd = ts.isCaseClause(clause)
    ? clause.expression.end
    : clause.getStart(sourceFile) + "default".length;
  const bodyStart = clause.statements.length > 0
    ? clause.statements[0]!.getStart(sourceFile)
    : clause.end;
  if (bodyStart <= headerEnd || bodyStart > source.length) return undefined;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
    undefined,
    headerEnd,
    bodyStart - headerEnd,
  );
  const token = scanner.scan();
  if (token === ts.SyntaxKind.ColonToken) return undefined;
  if (token === ts.SyntaxKind.EndOfFileToken) {
    // Nothing at all between the header and the body: `case "a" "alpha"`. A
    // clause with no statements is instead one the parser closed at its header
    // (`case "a"` before the block's `}`), and the parser's own "':' expected"
    // already reports that one outside any suppression window.
    return clause.statements.length > 0
      ? { start: clause.statements[0]!.getStart(sourceFile), arrow: false }
      : undefined;
  }
  return { start: scanner.getTokenStart(), arrow: token === ts.SyntaxKind.EqualsGreaterThanToken };
}


/**
 * A checked call boundary cannot observe an exception thrown while ESM is
 * linking/evaluating its static dependency graph.  Keep that separate hazard
 * fail-closed: a runtime foreign module must make an explicit, file-leading
 * trust claim before a `.sm` module can load it statically.
 *
 * Dynamic import deliberately is not handled here.  A trusted thin foreign
 * module may expose an async function which performs `import()`; its rejection
 * is then caught by the ordinary foreign async-call boundary.
 */
function checkForeignModuleInitializers(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  for (const statement of sourceFile.statements) {
    const edge = staticRuntimeModuleEdge(statement);
    if (!edge || isCompilerIntrinsicSpecifier(edge.specifier.text)) continue;

    const target = resolvedModuleSourceFile(edge.specifier, checker);
    if (target && isSmithersSemanticSourceFile(target.fileName)) continue;
    if (target && !isTypeScriptOrJavaScriptSourceFile(target.fileName)) continue;
    if (target && hasLeadingModuleNoThrowMarker(target)) continue;

    const detail = target
      ? `'${edge.specifier.text}' (${target.fileName}) does not declare a leading JSDoc containing both @module and @throws {never}`
      : `'${edge.specifier.text}' could not be resolved to a module carrying a leading JSDoc containing both @module and @throws {never}`;
    diagnostics.push(at(
      edge.specifier,
      sourceFile,
      "SMITHERS1510",
      `foreign module initialization can panic before a checked call boundary; ${detail}; use a type-only import, add the trusted marker, or put dynamic import behind a checked async foreign adapter`,
    ));
  }
}

interface StaticRuntimeModuleEdge {
  readonly specifier: ts.StringLiteral;
}

function staticRuntimeModuleEdge(statement: ts.Statement): StaticRuntimeModuleEdge | undefined {
  if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    const clause = statement.importClause;
    if (clause?.isTypeOnly || (clause && allImportBindingsAreTypeOnly(clause))) return undefined;
    return { specifier: statement.moduleSpecifier };
  }
  if (ts.isExportDeclaration(statement) && statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)) {
    if (statement.isTypeOnly || allExportBindingsAreTypeOnly(statement)) return undefined;
    return { specifier: statement.moduleSpecifier };
  }
  if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly &&
    ts.isExternalModuleReference(statement.moduleReference) &&
    statement.moduleReference.expression && ts.isStringLiteral(statement.moduleReference.expression)) {
    return { specifier: statement.moduleReference.expression };
  }
  return undefined;
}

function allImportBindingsAreTypeOnly(clause: ts.ImportClause): boolean {
  return !clause.name && clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly);
}

function allExportBindingsAreTypeOnly(statement: ts.ExportDeclaration): boolean {
  return Boolean(statement.exportClause && ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.length > 0 &&
    statement.exportClause.elements.every((element) => element.isTypeOnly));
}

function isCompilerIntrinsicSpecifier(specifier: string): boolean {
  return COMPILER_INTRINSIC_SPECIFIERS.has(specifier);
}

/**
 * The authoritative set of compiler-owned module specifiers.
 *
 * Membership is EXACT. Prefix-matching `smithers:`/`smthrs/` has already been a
 * fail-open twice in this repository — once in the withdrawn portability
 * analyzer (`poc/src/targets/classify.ts`, deleted 2026-08-23 with the
 * portability pin, whose header recorded it), and once in
 * `poc/src/durable/implementation-contract.ts`, which now consumes this set —
 * because a specifier that merely begins with an owned prefix is ordinary
 * foreign code that no registry pins. The lesson outlived the file: this set is
 * the one registry, and a second mirror of it is what let the two drift.
 *
 * `poc/src/language/compile.ts` is NOT a mirror: `isCompilerVirtualModule`
 * answers a different question — which specifiers the emitter rewrites to the
 * runtime import — and `smthrs/schema-runtime` deliberately survives emit.
 */
export const COMPILER_INTRINSIC_SPECIFIERS: ReadonlySet<string> = new Set([
  "smthrs/context",
  "smthrs/provider",
  "smthrs/schema-runtime",
  "smithers:exceptions",
  "smithers:comptime",
  "smithers:flows",
]);

function resolvedModuleSourceFile(
  specifier: ts.StringLiteral,
  checker: ts.TypeChecker,
): ts.SourceFile | undefined {
  const symbol = checker.getSymbolAtLocation(specifier);
  const declaration = symbol?.declarations?.find((candidate) => {
    const file = candidate.getSourceFile();
    return file.fileName !== PRELUDE_NAME;
  });
  return declaration?.getSourceFile();
}

function isSmithersSemanticSourceFile(fileName: string): boolean {
  return /\.sm(?:\.ts)?$/i.test(fileName);
}

function isTypeScriptOrJavaScriptSourceFile(fileName: string): boolean {
  return /(?:\.d)?\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(fileName);
}

function hasLeadingModuleNoThrowMarker(sourceFile: ts.SourceFile): boolean {
  const first = sourceFile.statements[0];
  const leading = sourceFile.text.slice(0, first?.getStart(sourceFile) ?? sourceFile.text.length);
  return (leading.match(/\/\*\*[\s\S]*?\*\//g) ?? [])
    .some((comment) => /@module(?:\s|\*|$)/i.test(comment) &&
      /@throws\s*\{\s*never\s*\}/i.test(comment));
}

function isTrustedCompilerGeneratedRuntime(sourceFile: ts.SourceFile): boolean {
  return trustedCompilerRuntimeSourceFiles.has(sourceFile) &&
    sourceFile.fileName.endsWith(".__smithers_generated__.ts") &&
    hasLeadingModuleNoThrowMarker(sourceFile);
}

/**
 * @internal Reads the undocumented `parseDiagnostics` field the frontend
 * depends on for grammar acceptance. Exposed for fail-closed regression tests.
 */
export function internalParseDiagnostics(
  sourceFile: ts.SourceFile,
): readonly ts.DiagnosticWithLocation[] | undefined {
  return (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[] })
    .parseDiagnostics;
}

/**
 * @internal When the internal parser-diagnostics field is absent (as opposed
 * to present but empty), the frontend cannot prove the source parses and must
 * fail closed instead of silently accepting unverified syntax.
 */
export function parseDiagnosticsFailure(sourceFile: ts.SourceFile): PendingDiagnostic | undefined {
  if (internalParseDiagnostics(sourceFile) !== undefined) return undefined;
  return {
    severity: "error",
    code: "SMITHERS1002",
    message: "internal: typescript-js did not expose parser diagnostics for this file, so the frontend cannot prove the source matches the supported grammar and fails closed",
    start: 0,
  };
}

function scanSource(source: string): ScannedToken[] {
  // Template- and regex-aware: a `${...}` substitution must not skew the
  // token stream the removed-syntax and expression-keyword checks rely on.
  return [...scanRecoveryTokens(source)];
}

/**
 * Retired-syntax recognition is a GRAMMAR property, not a token-adjacency
 * property. Every retired operator below takes a right operand, and the binary
 * and postfix ones additionally take a left operand; a spelling that has
 * neither shape is a name, not the operator. Testing only the neighbouring
 * token misreports ordinary code — `{ try: doThing, catch: handleIt }` is a
 * plain object literal, `{ orelse: 7 }` a plain member, and neither is retired
 * Smithers grammar.
 *
 * The three predicates below are the whole discipline:
 *
 * - `beginsOperand`   — could this token start the operator's right operand?
 * - `tokenEndsExpression` (recover.ts) — did an expression finish to the left?
 * - `isMemberNameOccurrence` — is the word being used as a property name?
 *
 * `try` and `catch` are ECMAScript reserved words, so *every* legal occurrence
 * of them outside statement-form `try`/`catch` is a property name; the third
 * predicate is what recognizes those positions.
 */
const OPERAND_CANNOT_BEGIN_WITH: ReadonlySet<string> = new Set([
  ":", ",", ")", "}", "]", ";", "=", "=>", ".", "?", "?.",
]);

function beginsOperand(token: ScannedToken | undefined): boolean {
  if (!token || token.kind === ts.SyntaxKind.EndOfFileToken) return false;
  return !OPERAND_CANNOT_BEGIN_WITH.has(token.text);
}

/**
 * Tokens that can precede a member name in an object literal, class body,
 * interface body, or type literal. A reserved word followed by `(` or `<` at
 * one of these positions is a method or call signature, never a prefix or
 * postfix operator.
 */
const MEMBER_LIST_BOUNDARIES: ReadonlySet<string> = new Set([
  "{", "}", ",", ";", "*",
  "static", "async", "get", "set", "public", "private", "protected",
  "readonly", "override", "abstract", "declare",
]);

function isMemberNameOccurrence(tokens: readonly ScannedToken[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  // `promise.catch(...)`, `Result.try(...)`, `adapter?.catch`
  if (previous?.text === "." || previous?.text === "?.") return true;
  // `{ try: value }`, `interface I { catch: T }`, `const { catch: c } = source`
  if (next?.text === ":") return true;
  // `interface I { catch?: T }`, `type T = { try?(): void }`
  if (next?.text === "?" && (tokens[index + 2]?.text === ":" || tokens[index + 2]?.text === "(")) return true;
  // `{ try() {} }`, `class C { static catch() {} }`, `type T = { try<A>(): A }`
  if ((next?.text === "(" || next?.text === "<") &&
    MEMBER_LIST_BOUNDARIES.has(previous?.text ?? "")) return true;
  return false;
}

/**
 * The retired `throws`/`uses` clause is a suffix on a *complete* return type,
 * so the token before it must be able to end one. A type name that happens to
 * be spelled `uses` inside type arguments or a union (`Array<uses>`,
 * `string | throws`) is preceded by a token that cannot end a type.
 */
const TYPE_CANNOT_END_WITH: ReadonlySet<string> = new Set([
  "<", ",", "|", "&", "(", "[", ":", "?", "=>", ".", "...",
  "extends", "keyof", "typeof", "readonly", "infer", "new", "is", "asserts",
]);

function endsReturnType(token: ScannedToken | undefined): boolean {
  return token !== undefined && !TYPE_CANNOT_END_WITH.has(token.text);
}

/**
 * Type-only keyword spellings. `!string` in a value position would be a
 * logical negation of a variable named `string`; in an annotation it is the
 * retired `!T` marker. The keyword spelling is what separates the retired
 * marker from an ordinary `{ ok: !failed }` or `flag ? a : !b`.
 */
const TYPE_ONLY_KEYWORDS: ReadonlySet<string> = new Set([
  "string", "number", "boolean", "bigint", "symbol", "object",
  "any", "unknown", "never", "void",
]);

function hasLineBreakBetween(source: string, left: ScannedToken, right: ScannedToken): boolean {
  return /[\n\r\u2028\u2029]/.test(source.slice(left.end, right.start));
}

function isBetweenFunctionParametersAndBody(tokens: readonly ScannedToken[], index: number): boolean {
  let sawClose = false;
  for (let cursor = index - 1; cursor >= 0 && index - cursor < 80; cursor--) {
    const text = tokens[cursor]!.text;
    if (text === "{") return false;
    if (text === ")") sawClose = true;
    if (text === "function") return sawClose;
    if (text === ";" || text === "}") return false;
  }
  return false;
}

function checkHostGlobals(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  const forbiddenHostGlobals = new Set([
    "process",
    "window",
    "document",
    "console",
    "fetch",
    "setTimeout",
    "setInterval",
    "globalThis",
  ]);
  const visit = (node: ts.Node): void => {
    const sensitive = ambientAuthorityUses(node, checker);
    if (ts.isIdentifier(node) && forbiddenHostGlobals.has(node.text) &&
      !isDeclarationName(node) && !isPropertyNameNode(node) && !isInTypePosition(node) &&
      isAmbientGlobalReference(node, checker)) {
      diagnostics.push(at(node, sourceFile, "SMITHERS1601", `ambient host global '${node.text}' is unavailable; access it through a Context capability`));
    }

    for (const use of sensitive) {
      diagnostics.push(at(
        use.root,
        sourceFile,
        use.requirement === "Clock" ? "SMITHERS1602" : use.requirement === "Random" ? "SMITHERS1603" : "SMITHERS1601",
        use.requirement === "Host"
          ? "ambient host global 'crypto' is unavailable; access it through a Context capability"
          : `ambient ${use.description} is unavailable; access it through ${use.requirement}.context()`,
      ));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

interface AmbientAuthorityUse {
  readonly requirement: "Clock" | "Random" | "Host";
  readonly description: string;
  readonly root: ts.Identifier;
}

function ambientAuthorityUses(node: ts.Node, checker: ts.TypeChecker): readonly AmbientAuthorityUse[] {
  const declarationName = ts.isIdentifier(node) && isDeclarationName(node) &&
    !ts.isShorthandPropertyAssignment(node.parent);
  if (!ts.isIdentifier(node) || declarationName || isPropertyNameNode(node) ||
    isInTypePosition(node) || !["Date", "Math", "performance", "crypto"].includes(node.text) ||
    !isAmbientGlobalReference(node, checker)) return [];

  const requirements = ambientRequirementsForRootUse(node);
  return requirements.map((requirement): AmbientAuthorityUse => ({
    requirement,
    description: requirement === "Clock" ? (node.text === "performance" ? "monotonic-clock access" : "wall-clock access") : "randomness",
    root: node,
  }));
}

function ambientRequirementsForRootUse(root: ts.Identifier): readonly AmbientAuthorityUse["requirement"][] {
  const parent = root.parent;
  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === root) {
    const member = ts.isPropertyAccessExpression(parent)
      ? parent.name.text
      : parent.argumentExpression && ts.isStringLiteralLike(parent.argumentExpression)
        ? parent.argumentExpression.text
        : undefined;
    return ambientRequirementsForMembers(root.text, member === undefined ? undefined : [member]);
  }
  if (root.text === "Date" && (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.expression === root) {
    if (ts.isNewExpression(parent) && (parent.arguments?.length ?? 0) > 0) return [];
    return ["Clock"];
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === root && ts.isObjectBindingPattern(parent.name)) {
    return ambientRequirementsForMembers(root.text, bindingMemberNames(parent.name));
  }
  return ambientRequirementsForMembers(root.text, undefined);
}

/** Undefined means the whole root or a dynamically selected member escaped. */
function ambientRequirementsForMembers(
  root: string,
  members: readonly string[] | undefined,
): readonly AmbientAuthorityUse["requirement"][] {
  if (members === undefined) {
    if (root === "Date" || root === "performance") return ["Clock"];
    if (root === "Math") return ["Random"];
    return root === "crypto" ? ["Host"] : [];
  }
  const requirements = new Set<AmbientAuthorityUse["requirement"]>();
  for (const member of members) {
    if (root === "Date" && member === "now") requirements.add("Clock");
    else if (root === "Date" && !["parse", "UTC"].includes(member)) requirements.add("Clock");
    else if (root === "Math" && member === "random") requirements.add("Random");
    else if (root === "performance") requirements.add("Clock");
    else if (root === "crypto" && ["randomUUID", "getRandomValues"].includes(member)) requirements.add("Random");
    else if (root === "crypto") requirements.add("Host");
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

function isAmbientGlobalReference(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = ts.isShorthandPropertyAssignment(identifier.parent)
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier);
  if (!symbol) return true;
  if (symbol.flags & ts.SymbolFlags.Alias) return false;
  const declarations = symbol.declarations ?? [];
  return declarations.length === 0 || declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile);
}

function nearestFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (isSupportedFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function isExported(node: ts.Node): boolean {
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword) || hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return true;
  if (ts.isFunctionLike(node) && ts.isVariableDeclaration(node.parent)) {
    const statement = node.parent.parent.parent;
    return ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword);
  }
  return false;
}

function at(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  code: string,
  message: string,
  severity: "error" | "warning" = "error",
): PendingDiagnostic {
  return { severity, code, message, start: node.getStart(sourceFile) };
}

function lineAndColumn(sourceFile: ts.SourceFile, offset: number): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(Math.max(0, Math.min(offset, sourceFile.text.length)));
  return { line: position.line + 1, column: position.character + 1 };
}

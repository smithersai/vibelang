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
  collectControlFlowExpressionPlans,
  controlFlowValueExpression,
  type ControlFlowExpressionPlan,
  type ControlFlowPlanCollection,
  type DerivedLabeledValue,
  type DerivedLoopValue,
} from "./control-flow.ts";
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
  unwrap(): A
  unwrapOr(value: A): A
  expect(message: string): A
}
declare const Result: {
  all<const T extends readonly Result<unknown, Error>[]>(values: T): Result<unknown, Error>
  try<A>(body: () => A): Result<A, Panic>
  try<A, E extends Error>(body: () => A, mapper: (cause: unknown) => E): Result<A, E | Panic>
  tryPromise<A>(body: () => PromiseLike<A>): Promise<Result<A, Panic>>
  tryPromise<A, E extends Error>(body: () => PromiseLike<A>, mapper: (cause: unknown) => E): Promise<Result<A, E | Panic>>
}

interface Optional<A> {
  readonly __smithersOptional: { readonly value: A }
  isSome(): boolean
  isNone(): boolean
  match<B>(handlers: { some(value: A): B; none(): B }): B
  map<B>(fn: (value: A) => B): Optional<B>
  andThen<B>(fn: (value: A) => Optional<B>): Optional<B>
  filter(fn: (value: A) => boolean): Optional<A>
  tap(fn: (value: A) => unknown): Optional<A>
  unwrap(): A
  unwrapOr(value: A): A
  toResult<E extends Error>(error: E): Result<A, E>
  toNullable(): A | null
}
declare const Optional: {
  fromNullable<A>(value: A | null | undefined): Optional<A>
  all<const T extends readonly Optional<unknown>[]>(values: T): Optional<unknown>
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

declare module "smithers:native" {
  export function native<F extends (...args: never[]) => unknown>(pinned: F): F
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

export interface DeferPlan {
  readonly kind: "defer" | "errdefer";
  readonly marker: ts.ExpressionStatement;
  readonly cleanup: ts.ExpressionStatement;
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
  hasResultUnwrap: boolean;
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
  readonly deferPlans: ReadonlyMap<ts.ExpressionStatement, DeferPlan>;
  readonly controlFlowPlans: ReadonlyMap<ts.Statement, ControlFlowExpressionPlan>;
  /** Default-less switch expression plans with proven closed-union coverage. */
  readonly exhaustiveSwitches: ReadonlySet<ts.SwitchStatement>;
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

/** Map authored labeled-value coordinates into the derived parse tree. */
function derivedLabeledValues(recovery: RecoveredSource): readonly DerivedLabeledValue[] {
  const derived: DerivedLabeledValue[] = [];
  for (const labeled of recovery.labeledValues) {
    const labelStart = recovery.toDerived(labeled.labelStart);
    const valueStarts = labeled.valueStarts.map((offset) => recovery.toDerived(offset));
    if (labelStart === undefined || valueStarts.some((offset) => offset === undefined)) continue;
    derived.push({ labelStart, markerName: labeled.markerName, valueStarts: valueStarts as number[] });
  }
  return derived;
}

/** Map authored loop-value coordinates into the derived parse tree. */
function derivedLoopValues(recovery: RecoveredSource): readonly DerivedLoopValue[] {
  const derived: DerivedLoopValue[] = [];
  for (const loop of recovery.loopValues) {
    const loopLabelStart = recovery.toDerived(loop.loopLabelStart);
    const elseStart = recovery.toDerived(loop.elseStart);
    const valueStarts = loop.valueStarts.map((offset) => recovery.toDerived(offset));
    if (loopLabelStart === undefined || elseStart === undefined ||
      valueStarts.some((offset) => offset === undefined)) continue;
    derived.push({ loopLabelStart, markerName: loop.markerName, valueStarts: valueStarts as number[], elseStart });
  }
  return derived;
}

export function buildSemanticModel(source: string, options: AnalyzeOptions = {}): SemanticModel {
  const recovery = recoverSmithersSyntax(source);
  const environment = createProgram(recovery.parseSource, options.fileName);
  const { sourceFile, checker } = environment;
  const pending: PendingDiagnostic[] = [];
  const controlFlow = collectControlFlowExpressionPlans(
    recovery.parseSource,
    sourceFile,
    derivedLabeledValues(recovery),
    derivedLoopValues(recovery),
    checker,
  );
  for (const diagnostic of controlFlow.diagnostics) {
    pending.push({ severity: "error", ...diagnostic });
  }

  checkRemovedAndUnsupportedSyntax(recovery.parseSource, sourceFile, checker, controlFlow, recovery, pending);
  verifyOrderAssumptions(recovery, sourceFile, checker, pending);

  const functions = collectFunctions(sourceFile, checker);
  const functionByNode = new Map<ts.Node, SemanticFunction>();
  for (const fn of functions) functionByNode.set(fn.node, fn);

  const callEdges = new Map<ts.CallExpression, CallEdge>();
  const layerBindings = collectLayerBindings(sourceFile, checker);
  for (const fn of functions) {
    collectFacts(fn, checker, sourceFile, functions, functionByNode, layerBindings, pending, callEdges);
  }

  checkForeignValueBoundaries(sourceFile, checker, pending, callEdges, functionByNode);
  checkControlFlowExpressionValues(controlFlow, sourceFile, checker, callEdges, pending);
  inferRows(functions, checker, callEdges);
  const deferPlans = checkDeferStatements(sourceFile, checker, functions, functionByNode, callEdges, pending);
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
    deferPlans,
    controlFlowPlans: controlFlow.byHost,
    exhaustiveSwitches: controlFlow.exhaustiveSwitches,
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
  const controlFlowByFile = new Map<ts.SourceFile, ControlFlowPlanCollection>();
  for (const entry of environment.entries) {
    const pending: PendingDiagnostic[] = [];
    pendingByFile.set(entry.sourceFile, pending);
    const controlFlow = collectControlFlowExpressionPlans(
      entry.source,
      entry.sourceFile,
      derivedLabeledValues(entry.recovery),
      derivedLoopValues(entry.recovery),
      checker,
    );
    controlFlowByFile.set(entry.sourceFile, controlFlow);
    for (const diagnostic of controlFlow.diagnostics) {
      pending.push({ severity: "error", ...diagnostic });
    }
    checkRemovedAndUnsupportedSyntax(entry.source, entry.sourceFile, checker, controlFlow, entry.recovery, pending);
    verifyOrderAssumptions(entry.recovery, entry.sourceFile, checker, pending);
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
    checkControlFlowExpressionValues(
      controlFlowByFile.get(entry.sourceFile)!,
      entry.sourceFile,
      checker,
      callEdges,
      pendingByFile.get(entry.sourceFile)!,
    );
  }
  inferRows(functions, checker, callEdges);
  const deferPlans = new Map<ts.ExpressionStatement, DeferPlan>();
  for (const entry of environment.entries) {
    const pending = pendingByFile.get(entry.sourceFile)!;
    const fileFunctions = functions.filter((fn) => fn.node.getSourceFile() === entry.sourceFile);
    for (const [marker, plan] of checkDeferStatements(
      entry.sourceFile,
      checker,
      fileFunctions,
      functionByNode,
      callEdges,
      pending,
    )) deferPlans.set(marker, plan);
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
      deferPlans,
      controlFlowPlans: controlFlowByFile.get(entry.sourceFile)!.byHost,
      exhaustiveSwitches: controlFlowByFile.get(entry.sourceFile)!.exhaustiveSwitches,
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
      } else if (!edge?.panicExit && !isSyntheticResultUnwrap(node, checker)) {
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
        owner?.directRequirements.add("TypeScript");
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
  owner?.directRequirements.add("TypeScript");
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
    if (ts.isCallExpression(parent)) {
      if (isSyntheticResultUnwrap(parent, checker) && parent.expression === current) return true;
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
  owner.directRequirements.add("TypeScript");
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
      const signatureUsesAny = Boolean(node.type && containsSyntaxKind(node.type, ts.SyntaxKind.AnyKeyword)) ||
        node.parameters.some((parameter) => containsSyntaxKind(parameter, ts.SyntaxKind.AnyKeyword));
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
        directRequirements: new Set(signatureUsesAny ? ["TypeScript"] : []),
        requirements: new Set(),
        calls: [],
        provides: [],
        expectCalls: [],
        boundaryCallbacks: [],
        hasResultUnwrap: false,
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
    const inner = success ? shapeOfType(success, checker) : undefined;
    return {
      channel: inner?.channel === "optional" ? "result-optional" : "result",
      async: false,
      failures: error ? errorNames(error, checker) : new Set(["Error"]),
      successType: success,
    };
  }
  if (name === "Optional") {
    return { channel: "optional", async: false, failures: new Set(), successType: arguments_[0] };
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

    if (node.kind === ts.SyntaxKind.AnyKeyword) fn.directRequirements.add("TypeScript");

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
      if (ts.isIdentifier(node.expression) && node.expression.text === "eval" &&
        !checker.getSymbolAtLocation(node.expression)?.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile)) {
        fn.directRequirements.add("TypeScript");
      }
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
      if (foreign) {
        fn.directRequirements.add("TypeScript");
        if (propagatesFailure && !authoredBoundary) addForeignFailures(fn.directFailures, foreign);
      }

      if (isExpectSyntax(node)) fn.expectCalls.push(node);
      if (isPreludeResultBoundaryCall(node, checker)) {
        const boundaryBody = node.arguments[0];
        const callback = boundaryBody && isSupportedFunctionLike(boundaryBody)
          ? functionByNode.get(boundaryBody)
          : undefined;
        if (callback) fn.boundaryCallbacks.push(callback);
      }

      if (isResultUnwrap(node, checker, callEdges)) {
        fn.hasResultUnwrap = true;
        const receiver = (node.expression as ts.PropertyAccessExpression).expression;
        const shape = semanticExpressionShape(receiver, checker, callEdges);
        for (const failure of shape.failures) fn.directFailures.add(failure);
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

    if (ts.isIdentifier(node) && isRuntimeForeignIdentifier(node, checker, sourceFile)) {
      fn.directRequirements.add("TypeScript");
    }

    ts.forEachChild(node, (child) => visit(child, caughtByJavaScript));
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
    ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent) || ts.isAwaitExpression(parent))) {
    current = parent;
    parent = parent.parent;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === current && parent.name.text === "unwrap" &&
    ts.isCallExpression(parent.parent) && parent.parent.expression === parent) return true;
  if (ts.isReturnStatement(parent)) return true;
  return isReturnedOrUnwrapped(call);
}

function isReturnedOrUnwrapped(node: ts.Node): boolean {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent) || ts.isAwaitExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isReturnStatement(parent)) return true;
    return ts.isPropertyAccessExpression(parent) && parent.expression === current && parent.name.text === "unwrap";
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
    if (fn.hasResultUnwrap && !isResult && fn.bodyFailures.size === 0) {
      diagnostics.push(at(fn.node, fn.node.getSourceFile(), "SMITHERS1202", "Result.unwrap() requires an enclosing Result-returning function"));
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
  if (/Result<\s*Result</.test(text) || /Optional<\s*Optional</.test(text)) {
    diagnostics.push(at(fn.node.type, fn.node.getSourceFile(), "SMITHERS1203", "nested Result/Optional normalization is not specified; make the conversion explicit"));
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
  if (isSyntheticResultUnwrap(call, checker)) return undefined;
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
      "this foreign call/result use is not expression-order-safe in the POC; assign the checked result, unwrap it, and continue through an explicitly typed local adapter",
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

function isSyntheticResultUnwrap(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  if (!isUnwrapSyntax(call)) return false;
  const property = call.expression as ts.PropertyAccessExpression;
  const symbol = unalias(checker.getSymbolAtLocation(property.name), checker);
  if (symbol?.declarations?.some((declaration) => isCompilerPrelude(declaration.getSourceFile()))) return true;
  // Real foreign methods named `unwrap` retain their checker symbol and remain
  // ordinary foreign calls. `any.unwrap()` also lacks a symbol, so the pseudo
  // operation additionally requires a value produced by an unchecked foreign
  // call (the value that lowering will actually turn into Result).
  return !symbol &&
    foreignValueOrigin(property.expression, checker)?.uncheckedResult === true;
}

function isStableForeignCallee(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return isStableForeignCallee(expression.expression, checker);
  }
  if (ts.isIdentifier(expression)) return true;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return isStableForeignCallee(expression.expression, checker);
  }
  return ts.isCallExpression(expression) && isSyntheticResultUnwrap(expression, checker);
}

/** Prevent emitting `Result.try(() => make())(...)` before the checked result is unwrapped. */
function foreignResultIsUsedAsValue(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  let current: ts.Node = call;
  let parent = current.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent) || ts.isAwaitExpression(parent))) {
    current = parent;
    parent = parent.parent;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === current &&
    ts.isCallExpression(parent.parent) && parent.parent.expression === parent &&
    isSyntheticResultUnwrap(parent.parent, checker)) return false;
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
  if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === "Reflect" && call.expression.name.text === "panic") {
    const symbol = checker.getSymbolAtLocation(call.expression.expression);
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
  /** The value is the success of a call that will lower to Result and has not been unwrapped. */
  readonly uncheckedResult: boolean;
}

function foreignValueOrigin(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seenSymbols = new Set<ts.Symbol>(),
): ForeignValueOrigin | undefined {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) ||
    ts.isAwaitExpression(expression)) {
    return foreignValueOrigin(expression.expression, checker, seenSymbols);
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
    if (isSyntheticResultUnwrap(expression, checker)) {
      const receiver = foreignValueOrigin((expression.expression as ts.PropertyAccessExpression).expression, checker, seenSymbols);
      return receiver && { ...receiver, namespaceObject: false, uncheckedResult: false };
    }
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

function isRuntimeForeignIdentifier(
  node: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (isDeclarationName(node) || isInTypePosition(node) || isPropertyNameNode(node)) return false;
  const moduleName = importedModuleOfExpression(node, checker);
  if (!moduleName || isCompilerIntrinsicSpecifier(moduleName)) return false;
  const symbol = checker.getSymbolAtLocation(node);
  const resolved = unalias(symbol, checker);
  if (resolved?.declarations?.some((declaration) => {
    const file = declaration.getSourceFile();
    return file.fileName.endsWith(".sm.ts") || isTrustedCompilerGeneratedRuntime(file);
  })) {
    return false;
  }
  return Boolean(symbol?.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile));
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
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "context" || call.arguments.length !== 0) {
    return undefined;
  }
  const receiver = call.expression.expression;
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
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  if (!["then", "catch", "finally"].includes(call.expression.name.text)) return false;
  return Boolean(promisedType(checker.getTypeAtLocation(call.expression.expression), checker));
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
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== method) return false;
  const moduleName = importedModuleOfExpression(call.expression.expression, checker);
  if (moduleName === "smthrs/provider") return true;
  const symbol = unalias(checker.getSymbolAtLocation(call.expression.expression), checker);
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
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
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
    const missing = difference(callback.requirements, edge.provided);
    // This POC emits the TypeScript backend, which itself satisfies the
    // built-in compatibility requirement. Native pins are checked elsewhere.
    missing.delete("TypeScript");
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
          ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "tryPromise" &&
          isPreludeResultBoundaryCall(node, checker);
        // `native(fn)` is a compile-time assertion over the referenced
        // function's dependency graph: the intrinsic receives the reference,
        // checks it, and returns it unchanged. It never invokes the argument,
        // so no Promise is started and this rule — which DECISIONS
        // 'Concurrency' and requirements.mdx 'Scoping' both scope to every
        // STARTED Promise — has nothing to own. Refusing the pin here would
        // make it inapplicable to EVERY async function, which is the
        // I/O-shaped code whose portability the pin exists to certify, and
        // compatibility.mdx 'Native and Wasm Targets' is explicit that async
        // functions MUST NOT be rejected solely because runtime support is
        // required. The pin is recognized by prelude symbol identity, so a
        // locally declared `function native(...)` keeps the ordinary rule.
        const nativePinSubject = node.arguments[0] === argument && isNativePinCall(node, checker);
        if (!consumedProvide && !ownedBoundaryBody && !nativePinSubject) {
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
    ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return semanticExpressionShape(expression.expression, checker, callEdges, seenSymbols);
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
    if (isUnwrapSyntax(expression)) {
      const receiver = (expression.expression as ts.PropertyAccessExpression).expression;
      const receiverShape = semanticExpressionShape(receiver, checker, callEdges, seenSymbols);
      if (receiverShape.channel === "result" || receiverShape.channel === "result-optional") {
        return {
          channel: receiverShape.channel === "result-optional" ? "optional" : "plain",
          async: false,
          failures: new Set(),
          successType: receiverShape.successType,
        };
      }
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

export function isResultUnwrapExpression(call: ts.CallExpression, model: SemanticModel): boolean {
  if (!isUnwrapSyntax(call)) return false;
  const receiver = (call.expression as ts.PropertyAccessExpression).expression;
  return semanticExpressionShape(receiver, model.checker, model.callEdges).channel.startsWith("result");
}

function isResultUnwrap(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  if (!isUnwrapSyntax(call)) return false;
  const receiver = (call.expression as ts.PropertyAccessExpression).expression;
  return semanticExpressionShape(receiver, checker, callEdges).channel.startsWith("result");
}

function isUnwrapSyntax(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "unwrap" && call.arguments.length === 0;
}

export function isOptionalUnwrapExpression(call: ts.CallExpression, model: SemanticModel): boolean {
  return isOptionalUnwrap(call, model.checker, model.callEdges);
}

function isOptionalUnwrap(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  if (!isUnwrapSyntax(call)) return false;
  const receiver = (call.expression as ts.PropertyAccessExpression).expression;
  return semanticExpressionShape(receiver, checker, callEdges).channel === "optional";
}

function isExpectSyntax(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "expect";
}

function isResultExpectCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  if (!isExpectSyntax(call)) return false;
  const receiver = (call.expression as ts.PropertyAccessExpression).expression;
  return semanticExpressionShape(receiver, checker, callEdges).channel.startsWith("result");
}

export function isResultExpectExpression(call: ts.CallExpression, model: SemanticModel): boolean {
  return isResultExpectCall(call, model.checker, model.callEdges);
}

/** An authored `Result.try(...)` / `Result.tryPromise(...)` call on the prelude `Result` value. */
function isPreludeResultBoundaryCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const method = call.expression.name.text;
  if (method !== "try" && method !== "tryPromise") return false;
  const receiver = call.expression.expression;
  if (!ts.isIdentifier(receiver) || receiver.text !== "Result") return false;
  const symbol = unalias(checker.getSymbolAtLocation(receiver), checker);
  return Boolean(symbol?.declarations?.some((declaration) => isCompilerPrelude(declaration.getSourceFile())));
}

/**
 * An authored `native(fn)` pin on the compiler-owned `smithers:native`
 * intrinsic.
 *
 * Authority is checker symbol identity against this analyzer's own prelude —
 * the same rule `poc/src/targets/classify.ts` applies — so a renamed import or
 * a namespace read still pins, and a locally declared `function native(...)`,
 * or a `native` exported by any installed package, resolves elsewhere and pins
 * nothing.
 */
function isNativePinCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const symbol = unalias(checker.getSymbolAtLocation(call.expression), checker);
  return Boolean(symbol?.declarations?.some((declaration) => {
    if (!ts.isFunctionDeclaration(declaration) || declaration.name?.text !== "native") return false;
    if (!isCompilerPrelude(declaration.getSourceFile())) return false;
    const block = declaration.parent;
    return ts.isModuleBlock(block) && ts.isModuleDeclaration(block.parent) &&
      ts.isStringLiteral(block.parent.name) && block.parent.name.text === "smithers:native";
  }));
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
      if (kind !== "plain" && !producerConsumed(node, kind, checker, callEdges)) {
        diagnostics.push(at(node, sourceFile, kind === "result" ? "SMITHERS1301" : "SMITHERS1402",
          kind === "result"
            ? "Result value is not consumed; return, match, transform, inspect, or unwrap it"
            : "started Promise is not consumed with await, return, or an awaited recognized combinator"));
      }
    }
    if (ts.isNewExpression(node) && isPromiseType(checker.getTypeAtLocation(node), checker)) {
      if (!producerConsumed(node, "promise", checker, callEdges)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1402", "started Promise is not consumed with await, return, or an awaited recognized combinator"));
      }
    }
    if (ts.isAwaitExpression(node)) {
      const awaited = semanticExpressionShape(node.expression, checker, callEdges);
      if (awaited.async && awaited.channel.startsWith("result") &&
        !producerConsumed(node, "result", checker, callEdges)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1301", "await removes only Promise; the resulting Result must still be returned, matched, transformed, inspected, or unwrapped"));
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const symbol = unalias(checker.getSymbolAtLocation(node.name), checker);
      const kind = producedKind(node.initializer, checker, callEdges);
      if (symbol && kind !== "plain" && !variableChecked.has(symbol)) {
        variableChecked.add(symbol);
        const usages = (references.get(symbol) ?? []).filter((identifier) => identifier !== node.name);
        const consumed = usages.some((identifier) => referenceConsumes(identifier, kind, checker, callEdges));
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
        if (!usages.some((identifier) => referenceConsumes(identifier, kind, checker, callEdges))) {
          diagnostics.push(at(node.name, sourceFile, "SMITHERS1302", `Result parameter '${node.name.text}' is never consumed`));
        }
      }
    }
    if (ts.isCallExpression(node) && isUnwrapSyntax(node)) {
      const owner = nearestFunction(node);
      const info = owner && functionByNode.get(owner);
      if (isResultUnwrap(node, checker, callEdges)) {
        if (!info || (!info.declaredShape.channel.startsWith("result") && info.failures.size === 0)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1202", "Result.unwrap() requires an enclosing Result-returning function"));
        } else if (isInRepeatedLoopHeader(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1703", "Result.unwrap() in a loop condition, incrementor, or iteration expression needs per-iteration control-flow lowering; assign before the loop or unwrap inside its body"));
        } else if (!isSafeUnwrapPlacement(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1204", "Result.unwrap() in this expression would require control-flow-aware evaluation-order rewriting; assign the Result to a local and unwrap it in a simple statement"));
        }
      } else if (isOptionalUnwrap(node, checker, callEdges)) {
        const channel = info ? effectiveChannel(info) : undefined;
        if (channel !== "optional" && channel !== "result-optional") {
          diagnostics.push(at(node, sourceFile, "SMITHERS1206", "Optional.unwrap() requires an enclosing Optional-returning (or Result<Optional>-returning) function so absence can propagate; use unwrapOr/match or convert with toResult"));
        } else if (isInRepeatedLoopHeader(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1703", "Optional.unwrap() in a loop condition, incrementor, or iteration expression needs per-iteration control-flow lowering; assign before the loop or unwrap inside its body"));
        } else if (!isSafeUnwrapPlacement(node)) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1204", "Optional.unwrap() in this expression would require control-flow-aware evaluation-order rewriting; assign the Optional to a local and unwrap it in a simple statement"));
        }
      }
    }
    if (ts.isCallExpression(node) && isResultExpectCall(node, checker, callEdges)) {
      if (isInRepeatedLoopHeader(node)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1703", "Result.expect() in a loop condition, incrementor, or iteration expression needs per-iteration control-flow lowering; assign before the loop or expect inside its body"));
      } else if (!isSafeUnwrapPlacement(node)) {
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

function producerConsumed(
  expression: ts.Expression,
  kind: ProducedKind,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  let current: ts.Node = expression;
  for (;;) {
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) return true;
    if (ts.isReturnStatement(parent)) return true;
    // The concise body of an authored Result.try/tryPromise callback is
    // returned into the boundary, which awaits/consumes it by contract.
    if (isSupportedFunctionLike(parent) && parent.body === current &&
      isAuthoredResultBoundaryBody(parent, checker)) return true;
    if (isSupportedFunctionLike(parent) && parent.body === current &&
      isResultReturningCombinatorCallback(parent, checker, edges)) return true;
    if (kind === "promise" || kind === "promise-result") {
      if (ts.isAwaitExpression(parent)) return true;
      if (isInsideRecognizedPromiseCombinator(current, checker)) return combinatorConsumed(current, checker, edges);
      return false;
    }
    if (kind === "result") {
      if (isConsumedResultReceiver(current, parent)) return true;
      if (isInsideResultAll(current, checker)) return true;
      return false;
    }
    return false;
  }
}

function referenceConsumes(
  identifier: ts.Identifier,
  kind: ProducedKind,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  let current: ts.Node = identifier;
  for (;;) {
    const parent = current.parent;
    if (!parent) return false;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isReturnStatement(parent)) return true;
    if (isSupportedFunctionLike(parent) && parent.body === current &&
      isAuthoredResultBoundaryBody(parent, checker)) return true;
    if (isSupportedFunctionLike(parent) && parent.body === current &&
      isResultReturningCombinatorCallback(parent, checker, edges)) return true;
    if (kind === "result") {
      return isConsumedResultReceiver(current, parent) || isInsideResultAll(current, checker);
    }
    if (ts.isAwaitExpression(parent)) return true;
    if (isInsideRecognizedPromiseCombinator(current, checker)) return combinatorConsumed(current, checker, edges);
    return false;
  }
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
  "isOk", "isError", "match", "map", "mapError", "andThen", "recover", "tap", "tapError", "unwrap", "unwrapOr", "expect",
]);

// These transformations consume a Result returned by their callback rather
// than storing it as a nested success value or discarding it. Keep this list
// narrower than RESULT_CONSUMERS: map/tap callbacks do not flatten Results.
const RESULT_RETURNING_CALLBACK_CONSUMERS = new Set(["andThen", "recover"]);

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
function preludeMemberDeclaration(name: ts.MemberName, checker: ts.TypeChecker): ts.MethodSignature | undefined {
  const declaration = unalias(checker.getSymbolAtLocation(name), checker)?.declarations
    ?.find((candidate) => isCompilerPrelude(candidate.getSourceFile()));
  return declaration !== undefined && ts.isMethodSignature(declaration) && ts.isIdentifier(declaration.name)
    ? declaration
    : undefined;
}

/**
 * A member of the prelude's `Result` namespace value (`declare const Result`).
 * `Optional.all` is declared on its own value and never matches here, and
 * neither does any user object with an `all` member.
 */
function isPreludeResultNamespaceMember(
  name: ts.MemberName,
  checker: ts.TypeChecker,
  members: ReadonlySet<string>,
): boolean {
  const declaration = preludeMemberDeclaration(name, checker);
  if (declaration === undefined || !ts.isTypeLiteralNode(declaration.parent)) return false;
  const owner = declaration.parent.parent;
  return ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name) && owner.name.text === "Result" &&
    members.has((declaration.name as ts.Identifier).text);
}

function isResultReturningCombinatorCallback(
  callback: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
  edges: ReadonlyMap<ts.CallExpression, CallEdge>,
): boolean {
  let current: ts.Node = callback;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const call = current.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== current ||
    !ts.isPropertyAccessExpression(call.expression) ||
    !RESULT_RETURNING_CALLBACK_CONSUMERS.has(call.expression.name.text)) return false;
  // Receiver precondition, exactly as in `isConsumedResultReceiver`: the
  // spelling only decides WHICH member of an already-established Result-channel
  // value was selected.
  return semanticExpressionShape(call.expression.expression, checker, edges).channel.startsWith("result");
}

function isConsumedResultReceiver(current: ts.Node, parent: ts.Node): boolean {
  return ts.isPropertyAccessExpression(parent) && parent.expression === current &&
    RESULT_CONSUMERS.has(parent.name.text) &&
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
  return ts.isCallExpression(parent) && parent.arguments.includes(current as ts.Expression) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    isPreludeResultNamespaceMember(parent.expression.name, checker, RESULT_NAMESPACE_CONSUMERS);
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
  if (!ts.isCallExpression(parent) || !parent.arguments.includes(current as ts.Expression) || !ts.isPropertyAccessExpression(parent.expression)) return false;
  if (!isAmbientPromiseNamespace(parent.expression.expression, checker)) return false;
  return ["all", "allSettled", "race", "any", "allKeyed", "allSettledKeyed"].includes(parent.expression.name.text) &&
    Boolean(promisedType(checker.getTypeAtLocation(parent), checker));
}

function combinatorConsumed(node: ts.Node, checker: ts.TypeChecker, edges: ReadonlyMap<ts.CallExpression, CallEdge>): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) &&
      isAmbientPromiseNamespace(current.expression.expression, checker)) {
      return producerConsumed(current, "promise", checker, edges);
    }
    current = current.parent;
  }
  return false;
}

function isPromiseType(type: ts.Type, checker: ts.TypeChecker): boolean {
  return Boolean(promisedType(type, checker));
}

function isSafeUnwrapPlacement(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  while (current.parent && !ts.isStatement(current.parent) && !ts.isArrowFunction(current.parent)) {
    const parent = current.parent;
    if (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
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
 * Panic exits and unwrap propagation lower to early `return` statements. An
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
    if (caughtByJavaScript && ts.isCallExpression(node)) {
      const construct = callEdges.get(node)?.panicExit
        ? "panic(...)"
        : isResultExpectCall(node, checker, callEdges)
          ? "Result.expect()"
        : isResultUnwrap(node, checker, callEdges)
          ? "Result.unwrap()"
          : isOptionalUnwrap(node, checker, callEdges)
            ? "Optional.unwrap()"
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
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const owner = node.expression.text;
      if ((owner === "Result" && ["ok", "err", "error", "success"].includes(node.name.text)) ||
        (owner === "Optional" && ["some", "none"].includes(node.name.text))) {
        const symbol = checker.getSymbolAtLocation(node.expression);
        if (!symbol || symbol.declarations?.some((declaration) => isCompilerPrelude(declaration.getSourceFile()))) {
          diagnostics.push(at(node, sourceFile, "SMITHERS1201", `${owner}.${node.name.text} is a compiler hook, not an author-facing constructor; use ordinary return/throw lifting`));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function isErrorMatchCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  if (!ts.isPropertyAccessExpression(call.expression) ||
    !["match", "matchPartial"].includes(call.expression.name.text)) return false;
  return isErrorType(checker.getTypeAtLocation(call.expression.expression), checker);
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
      const property = node.expression as ts.PropertyAccessExpression;
      const partial = property.name.text === "matchPartial";
      const handlers = node.arguments[0];
      if (!handlers || !ts.isObjectLiteralExpression(handlers)) {
        diagnostics.push(at(node, sourceFile, "SMITHERS1251", `Error.${property.name.text} requires an object literal so nominal cases can be checked and lowered`));
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
          const expected = errorNamesOfType(checker.getTypeAtLocation(property.expression), checker);
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

function checkDeferStatements(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  _functions: readonly SemanticFunction[],
  functionByNode: ReadonlyMap<ts.Node, SemanticFunction>,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  diagnostics: PendingDiagnostic[],
): ReadonlyMap<ts.ExpressionStatement, DeferPlan> {
  const plans = new Map<ts.ExpressionStatement, DeferPlan>();
  const visit = (node: ts.Node): void => {
    if (isDeferMarkerStatement(node)) {
      const kind = node.expression.text as "defer" | "errdefer";
      const ownerNode = nearestFunction(node);
      const owner = ownerNode ? functionByNode.get(ownerNode) : undefined;
      if (!owner || !ts.isBlock(node.parent)) {
        diagnostics.push(at(
          node,
          sourceFile,
          "SMITHERS1710",
          `${kind} must be a direct statement in a braced function/block scope; single-statement, case-clause, labeled, and top-level placement is not lowered`,
        ));
      } else {
        const statements = node.parent.statements;
        const index = statements.indexOf(node);
        const cleanup = statements[index + 1];
        const sameLine = cleanup && sourceFile.getLineAndCharacterOfPosition(node.end).line ===
          sourceFile.getLineAndCharacterOfPosition(cleanup.getStart(sourceFile)).line;
        const paired = !node.getText(sourceFile).trimEnd().endsWith(";") && sameLine &&
          cleanup && ts.isExpressionStatement(cleanup) && !isDeferMarkerStatement(cleanup);
        if (!paired) {
          diagnostics.push(at(
            node,
            sourceFile,
            "SMITHERS1710",
            `${kind} requires one cleanup expression on the same statement line (without a semicolon after ${kind}); block/declaration/missing cleanups are unsupported`,
          ));
        } else {
          let valid = true;
          if (kind === "errdefer" && !effectiveChannel(owner).startsWith("result")) {
            diagnostics.push(at(
              node,
              sourceFile,
              "SMITHERS1711",
              "errdefer is defined only in a Result (or Promise<Result>) owner because the POC gates cleanup on an emitted Result error variant",
            ));
            valid = false;
          }
          if (!checkDeferCleanup(cleanup.expression, owner, sourceFile, checker, callEdges, diagnostics)) {
            valid = false;
          }
          if (kind === "errdefer" && !checkErrdeferTail(
            statements.slice(index + 2),
            owner,
            sourceFile,
            checker,
            callEdges,
            diagnostics,
          )) valid = false;
          if (valid) plans.set(node, { kind, marker: node, cleanup });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return plans;
}

function isDeferMarkerStatement(node: ts.Node): node is ts.ExpressionStatement & { readonly expression: ts.Identifier } {
  return ts.isExpressionStatement(node) && ts.isIdentifier(node.expression) &&
    (node.expression.text === "defer" || node.expression.text === "errdefer");
}

function checkDeferCleanup(
  expression: ts.Expression,
  owner: SemanticFunction,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  diagnostics: PendingDiagnostic[],
): boolean {
  const awaits: ts.AwaitExpression[] = [];
  let unsafeChannel: ts.Node | undefined;
  let unsafeReason: string | undefined;
  const root = unwrapCleanupParentheses(expression);
  const awaitedRoot = ts.isAwaitExpression(root) ? unwrapCleanupParentheses(root.expression) : undefined;
  const visit = (node: ts.Node): void => {
    if (unsafeChannel) return;
    if (node !== expression && isSupportedFunctionLike(node)) return;
    if (ts.isAwaitExpression(node)) awaits.push(node);
    if (ts.isCallExpression(node)) {
      if (isPanicCall(node, checker) || callEdges.get(node)?.panicExit ||
        isResultExpectCall(node, checker, callEdges)) {
        unsafeChannel = node;
        unsafeReason = "panic exits";
        return;
      }
      if (isResultUnwrap(node, checker, callEdges)) {
        unsafeChannel = node;
        unsafeReason = "Result.unwrap propagation";
        return;
      }
      if (isOptionalUnwrap(node, checker, callEdges)) {
        unsafeChannel = node;
        unsafeReason = "Optional.unwrap propagation";
        return;
      }
      const shape = semanticExpressionShape(node, checker, callEdges);
      if (shape.channel.startsWith("result")) {
        unsafeChannel = node;
        unsafeReason = "a Result-producing call";
        return;
      }
      if (shape.async && node !== awaitedRoot) {
        unsafeChannel = node;
        unsafeReason = "an unowned Promise-producing call";
        return;
      }
    }
    if (ts.isNewExpression(node) && promisedType(checker.getTypeAtLocation(node), checker)) {
      if (node !== awaitedRoot) {
        unsafeChannel = node;
        unsafeReason = "an unowned Promise construction";
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);

  const shape = semanticExpressionShape(expression, checker, callEdges);
  if (!unsafeChannel && shape.channel.startsWith("result")) {
    unsafeChannel = expression;
    unsafeReason = "a Result value";
  }
  if (!unsafeChannel && shape.async) {
    unsafeChannel = expression;
    unsafeReason = "an unawaited Promise value";
  }
  if (!unsafeChannel && awaits.length > 0 && (!owner.async || !ts.isAwaitExpression(root) || awaits.length !== 1)) {
    unsafeChannel = awaits[0];
    unsafeReason = owner.async
      ? "nested/multiple await cleanup whose evaluation order is ambiguous"
      : "await cleanup in a non-async owner";
  }
  if (unsafeChannel) {
    diagnostics.push(at(
      unsafeChannel,
      sourceFile,
      "SMITHERS1712",
      `defer cleanup contains ${unsafeReason}; cleanup failure composition is not specified, so handle it in a plain/awaited non-failing adapter before registering cleanup`,
    ));
    return false;
  }
  return true;
}

function unwrapCleanupParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
  return current;
}

function checkErrdeferTail(
  statements: readonly ts.Statement[],
  owner: SemanticFunction,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  diagnostics: PendingDiagnostic[],
): boolean {
  if (!owner.async) return true;
  let unsafe: ts.ReturnStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    if (isSupportedFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression &&
      semanticExpressionShape(node.expression, checker, callEdges).async) {
      unsafe = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of statements) visit(statement);
  if (!unsafe) return true;
  diagnostics.push(at(
    unsafe,
    sourceFile,
    "SMITHERS1713",
    "async errdefer cannot inspect a directly returned Promise before finally runs; await the Result-producing expression explicitly before returning it",
  ));
  return false;
}

function checkRemovedAndUnsupportedSyntax(
  source: string,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  controlFlow: ControlFlowPlanCollection,
  recovery: RecoveredSource,
  diagnostics: PendingDiagnostic[],
): void {
  const tokens = scanSource(source);
  const explicitOffsets: number[] = [...recovery.rejectedStarts];
  const removed = (token: ScannedToken, message: string): void => {
    explicitOffsets.push(token.start);
    diagnostics.push({ severity: "error", code: "SMITHERS1001", message, start: token.start });
  };
  const unsupported = (token: ScannedToken, code: string, message: string): void => {
    explicitOffsets.push(token.start);
    diagnostics.push({ severity: "error", code, message, start: token.start });
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
    if (token.text === "?" && (previous?.text === ":" ||
      (previous?.text === "!" && tokens[index - 2]?.text === ":")) && next && /^[A-Za-z_$]/.test(next.text)) {
      removed(token, "the `?T` type grammar was removed; use Optional<T>");
    }
    if (token.text === "orelse" && previous?.text !== "." &&
      !isMemberNameOccurrence(tokens, index) &&
      tokenEndsExpression(previous?.kind) && beginsOperand(next)) {
      // `orelse` is a binary operator, so it needs both operands. `orelse` is
      // also an ordinary identifier: `const orelse = 1`, `{ orelse }`,
      // `{ orelse: 7 }`, `String(orelse)`, and `orelse()` are all legal.
      removed(token, "the `orelse` operator was removed; use Optional.match(), map(), or unwrapOr()");
    }
    if (token.text === "." && next?.text === "?") {
      removed(token, "the `.?` postfix operator was removed; use Optional.unwrap()");
    }
    if (token.text === "try" && next?.text !== "{" &&
      !isMemberNameOccurrence(tokens, index) && beginsOperand(next)) {
      // The retired prefix marker takes a right operand. `try` is a reserved
      // word, so every other legal spelling is a property name: the public
      // `Result.try(...)` API, `{ try: adapt }`, `{ try() {} }`, and
      // `interface I { try: T }`.
      removed(token, "the prefix `try` propagation marker was removed; use Result.unwrap()");
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
    if ((token.text === "defer" || token.text === "errdefer") && previous?.text !== "." && next?.text !== "(") {
      // TypeScript recovers `defer expr` as two adjacent expression statements.
      // The semantic defer pass owns the shape diagnostic and lowering plan;
      // suppress only the parser's expected "unexpected identifier" duplicate.
      explicitOffsets.push(token.start);
    }
    if (["if", "switch", "for", "while"].includes(token.text) && isExpressionKeyword(source, tokens, index)) {
      if (controlFlow.recoveredKeywordStarts.has(token.start)) {
        // The recovery parser deliberately reports a missing TS expression at
        // this token. A checked plan owns the construct (or emitted SMITHERS1705).
        explicitOffsets.push(token.start);
      } else if (recovery.statementStarts.has(token.start)) {
        // Pre-parse recovery proved this keyword begins an ordinary
        // statement (for example after `case x:`), not a value expression.
      } else if (recovery.rejectedStarts.has(token.start)) {
        // Pre-parse recovery already reported a specific placement
        // diagnostic; keep parse-noise suppression without double-reporting.
        explicitOffsets.push(token.start);
      } else {
        unsupported(token, "SMITHERS1702", `${token.text} expressions require checked control-flow IR and are not emitted by this POC`);
      }
    }
  }

  // Switch clauses are colon-delimited, exactly as in TypeScript. The
  // specification's Switch section requires the TypeScript `switch`/`case`/
  // `default` grammar and states that Smithers MUST NOT introduce a separate
  // arrow-arm switch grammar, so `case x => v` is not a Smithers form in any
  // position — and neither is a clause with no separator at all.
  //
  // TypeScript's parser recovers both by pretending the colon was written,
  // which leaves the clause textually indistinguishable from `case x: v` in the
  // tree; the only surviving signal is the parser's own "':' expected", and the
  // proximity suppression below swallows it whenever the malformed clause is
  // within 48 characters of a recovered `switch` expression host. That made
  // acceptance depend on the DISTANCE from the switch keyword: `case "a"
  // "alpha"` on the first clause of an expression switch compiled and lowered,
  // while the same shape one clause further down was rejected. Claim the
  // separator from the clause itself so the rule is positional-independent and
  // holds in expression and statement position alike.
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
    const recovered = [...controlFlow.byControl.values()].some((plan) => {
      const controlStart = plan.control.getStart(sourceFile);
      if (start === controlStart && message === "Expression expected.") return true;
      if (plan.kind !== "if" || ts.isBlock(plan.control.thenStatement)) return false;
      if (start === plan.control.thenStatement.getStart(sourceFile) &&
        message === "Unexpected keyword or identifier.") return true;
      return Boolean(plan.control.elseStatement && start >= plan.control.thenStatement.end &&
        start <= plan.control.elseStatement.getStart(sourceFile) && message === "';' expected.");
    });
    if (recovered || explicitOffsets.some((offset) => Math.abs(offset - start) < 48)) continue;
    diagnostics.push({
      severity: "error",
      code: "SMITHERS1000",
      message: `source does not match the supported .sm grammar: ${message}`,
      start,
    });
  }

  const visitUnsupportedAst = (node: ts.Node): void => {
    if (ts.isLabeledStatement(node) && !controlFlow.claimedLabels.has(node)) {
      diagnostics.push(at(node.label, sourceFile, "SMITHERS1704", "labeled control flow requires label-aware lowering and is not emitted by this POC"));
    }
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

function checkControlFlowExpressionValues(
  plans: ControlFlowPlanCollection,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  callEdges: ReadonlyMap<ts.CallExpression, CallEdge>,
  diagnostics: PendingDiagnostic[],
): void {
  for (const plan of plans.byHost.values()) {
    const exits = plan.kind === "if"
      ? [plan.consequent, plan.alternate]
      : plan.kind === "switch"
        ? plan.clauses.map((clause) => clause.exit)
        : plan.kind === "labeled-block"
          ? plan.sites.map((site) => site.value)
          : [...plan.sites.map((site) => site.value), plan.elseValue];
    for (const exit of exits) {
      const expression = controlFlowValueExpression(exit);
      if (!expression) continue;
      const shape = semanticExpressionShape(expression, checker, callEdges);
      if (shape.async || shape.channel.startsWith("result") ||
        (ts.isCallExpression(expression) &&
          (callEdges.get(expression)?.panicExit === true || isResultExpectCall(expression, checker, callEdges)))) {
        diagnostics.push(at(
          expression,
          sourceFile,
          "SMITHERS1706",
          "this control-flow value needs failure/task ownership in the shared expression IR; await or unwrap it before the branch value, or use a throw statement",
        ));
      }
      if (controlFlowValueHasLocalType(expression, plan.control, checker)) {
        diagnostics.push(at(
          expression,
          sourceFile,
          "SMITHERS1706",
          "this branch value exposes a type declared inside the control-flow expression; add an outer structural annotation or move the type declaration outside the expression",
        ));
      }
    }
    if (plan.kind === "switch") {
      for (const clause of plan.clauses) {
        if (!ts.isCaseClause(clause.clause)) continue;
        const caseClause = clause.clause;
        let unsafe: ts.CallExpression | undefined;
        const visit = (node: ts.Node): void => {
          if (unsafe || (node !== caseClause.expression && ts.isFunctionLike(node))) return;
          if (ts.isCallExpression(node) &&
            (isResultUnwrap(node, checker, callEdges) || isOptionalUnwrap(node, checker, callEdges) ||
              isResultExpectCall(node, checker, callEdges) || callEdges.get(node)?.panicExit === true)) {
            unsafe = node;
            return;
          }
          ts.forEachChild(node, visit);
        };
        visit(caseClause.expression);
        if (unsafe) diagnostics.push(at(
          unsafe,
          sourceFile,
          "SMITHERS1706",
          "switch expression case labels cannot perform Result propagation or panic exits because their ordered selection cannot emit a statement prologue",
        ));
      }
    }
  }
}

/**
 * Expression-placement recovery leaves each callee evaluated ahead of a
 * hoisted construct in place, because binding it to a temporary would break
 * `this` and the direct static-call row analysis. That is only sound when the
 * callee value cannot change between the authored fetch point and the derived
 * fetch point, so every assumption is proven here and rejected otherwise.
 */
function verifyOrderAssumptions(
  recovery: RecoveredSource,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: PendingDiagnostic[],
): void {
  if (recovery.assumptions.length === 0) return;
  const written = writtenValueTargets(sourceFile, checker);
  const fail = (start: number, message: string): void => {
    diagnostics.push({ severity: "error", code: "SMITHERS1708", message, start });
  };
  const stableIdentifier = (identifier: ts.Identifier, start: number): boolean => {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (!symbol) {
      fail(start, `callee '${identifier.text}' ahead of a recovered value expression cannot be resolved, so its evaluation-order stability is unprovable`);
      return false;
    }
    if (written.symbols.has(symbol)) {
      fail(start, `callee '${identifier.text}' is reassigned in this module, so evaluating it after a hoisted value expression could observe a different function; bind it to a const first`);
      return false;
    }
    return true;
  };
  for (const assumption of recovery.assumptions) {
    const start = recovery.toDerived(assumption.authoredStart);
    const last = recovery.toDerived(assumption.authoredEnd - 1);
    if (start === undefined || last === undefined) {
      fail(0, "internal: an order-stability assumption lost its source position; the recovered placement is rejected");
      continue;
    }
    const end = last + 1;
    const node = findNodeWithSpan(sourceFile, start, end);
    if (!node) {
      fail(start, "internal: an order-stability assumption does not correspond to a parsed callee; the recovered placement is rejected");
      continue;
    }
    if (ts.isIdentifier(node)) {
      stableIdentifier(node, start);
      continue;
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
      if (ts.isIdentifier(node.expression) && !stableIdentifier(node.expression, start)) continue;
      if (!ts.isIdentifier(node.expression) && node.expression.kind !== ts.SyntaxKind.ThisKeyword) {
        fail(start, "the callee receiver ahead of a recovered value expression cannot be proven order-stable");
        continue;
      }
      const member = checker.getSymbolAtLocation(node.name);
      if (!member || !stableMemberSymbol(member, checker)) {
        fail(start, `member callee '${node.name.text}' ahead of a recovered value expression is not a provably stable method; bind the receiver and method to checked locals first`);
        continue;
      }
      if (written.memberNames.has(node.name.text)) {
        fail(start, `member callee '${node.name.text}' is assigned somewhere in this module, so evaluating it after a hoisted value expression could observe a different function`);
      }
      continue;
    }
    fail(start, "the callee ahead of a recovered value expression has an unsupported shape for order-stability verification");
  }
}

function findNodeWithSpan(sourceFile: ts.SourceFile, start: number, end: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (node.end < start || node.getStart(sourceFile) > start) return;
    if (node.getStart(sourceFile) === start && node.end === end) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

interface WrittenValueTargets {
  readonly symbols: ReadonlySet<ts.Symbol>;
  /** Property names assigned through any member expression in this module. */
  readonly memberNames: ReadonlySet<string>;
}

const writtenValueTargetsCache = new WeakMap<ts.SourceFile, WrittenValueTargets>();

function writtenValueTargets(sourceFile: ts.SourceFile, checker: ts.TypeChecker): WrittenValueTargets {
  const cached = writtenValueTargetsCache.get(sourceFile);
  if (cached) return cached;
  const symbols = new Set<ts.Symbol>();
  const memberNames = new Set<string>();
  const collectTarget = (expression: ts.Expression): void => {
    if (ts.isParenthesizedExpression(expression)) {
      collectTarget(expression.expression);
      return;
    }
    if (ts.isIdentifier(expression)) {
      const symbol = checker.getSymbolAtLocation(expression);
      if (symbol) symbols.add(symbol);
      return;
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
      memberNames.add(expression.name.text);
      return;
    }
    if (ts.isElementAccessExpression(expression)) return; // dynamic member writes gate members via type checks only
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) {
        if (ts.isOmittedExpression(element)) continue;
        if (ts.isSpreadElement(element)) collectTarget(element.expression);
        else if (ts.isBinaryExpression(element) && element.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          collectTarget(element.left);
        } else collectTarget(element);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) collectTarget(property.initializer);
        else if (ts.isShorthandPropertyAssignment(property)) {
          const symbol = checker.getShorthandAssignmentValueSymbol(property) ??
            checker.getSymbolAtLocation(property.name);
          if (symbol) symbols.add(symbol);
        } else if (ts.isSpreadAssignment(property)) collectTarget(property.expression);
      }
      return;
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && assignmentWritesLeft(node.operatorToken.kind)) {
      collectTarget(node.left);
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      collectTarget(node.operand as ts.Expression);
    }
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
      collectTarget(node.initializer as ts.Expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const result: WrittenValueTargets = { symbols, memberNames };
  writtenValueTargetsCache.set(sourceFile, result);
  return result;
}

function assignmentWritesLeft(operator: ts.SyntaxKind): boolean {
  return operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment;
}

function stableMemberSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  const resolved = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  const declarations = resolved.declarations ?? [];
  if (declarations.length === 0) return false;
  return declarations.every((declaration) =>
    ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration) ||
    ts.isFunctionDeclaration(declaration) ||
    ((ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)) &&
      (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0) ||
    (ts.isVariableDeclaration(declaration) && (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0));
}

const isNodeWithin = (node: ts.Node, boundary: ts.Node): boolean => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === boundary) return true;
    current = current.parent;
  }
  return false;
};

/** @internal Used by lowering to keep generated join types checker-valid. */
export function controlFlowValueHasLocalType(
  expression: ts.Expression,
  control: ts.IfStatement | ts.SwitchStatement | ts.LabeledStatement,
  checker: ts.TypeChecker,
): boolean {
  const seen = new Set<ts.Type>();
  const inspect = (type: ts.Type): boolean => {
    if (seen.has(type)) return false;
    seen.add(type);
    if (type.isUnionOrIntersection()) return type.types.some(inspect);

    const symbols = [type.aliasSymbol, type.getSymbol()].filter(
      (symbol): symbol is ts.Symbol => Boolean(symbol),
    );
    const inaccessibleMask = ts.SymbolFlags.Class | ts.SymbolFlags.Interface |
      ts.SymbolFlags.Enum | ts.SymbolFlags.TypeAlias;
    if (symbols.some((symbol) => (symbol.flags & inaccessibleMask) !== 0 &&
      symbol.declarations?.some((declaration) => isNodeWithin(declaration, control)))) return true;
    if ((type.flags & ts.TypeFlags.UniqueESSymbol) !== 0 && symbols.some((symbol) =>
      symbol.declarations?.some((declaration) => isNodeWithin(declaration, control)))) return true;

    if (type.aliasTypeArguments?.some(inspect)) return true;
    if ((type.flags & ts.TypeFlags.Object) !== 0) {
      const reference = type as ts.TypeReference;
      if (reference.target && checker.getTypeArguments(reference).some(inspect)) return true;
    }

    // Anonymous structural values can hide a local nominal type in a field or
    // signature even though their own generated type literal is name-free.
    const symbol = type.getSymbol();
    if (!symbol || symbol.name.startsWith("__")) {
      for (const property of checker.getPropertiesOfType(type)) {
        const location = property.valueDeclaration ?? property.declarations?.[0] ?? expression;
        if (inspect(checker.getTypeOfSymbolAtLocation(property, location))) return true;
      }
      for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
        if (inspect(checker.getReturnTypeOfSignature(signature))) return true;
        for (const parameter of signature.parameters) {
          const location = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? expression;
          if (inspect(checker.getTypeOfSymbolAtLocation(parameter, location))) return true;
        }
      }
      const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String);
      const numberIndex = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if ((stringIndex && inspect(stringIndex)) || (numberIndex && inspect(numberIndex))) return true;
    }
    return false;
  };
  return inspect(checker.getTypeAtLocation(expression));
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
 * fail-open twice in this repository — once in `poc/src/targets/classify.ts`,
 * whose comment records it, and once in
 * `poc/src/durable/implementation-contract.ts`, which now consumes this set —
 * because a specifier that merely begins with an owned prefix is ordinary
 * foreign code that no registry pins.
 *
 * `poc/src/targets/classify.ts` keeps a mirror of this list for the portability
 * analyzer (plus its provisional `smithers:native` entry). That file is owned by
 * another lane; consolidating the two is a separate, deliberate change.
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
  "smithers:native",
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

function isExpressionKeyword(source: string, tokens: readonly ScannedToken[], index: number): boolean {
  const previousToken = tokens[index - 1];
  const previous = previousToken?.text;
  if (previous === "return" && /[\n\r\u2028\u2029]/.test(source.slice(previousToken!.end, tokens[index]!.start))) {
    return false;
  }
  if (["=", "return", "=>", ",", "(", "["].includes(previous ?? "")) return true;
  return previous === ":" && tokens[index - 2]?.kind === ts.SyntaxKind.Identifier;
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

function containsSyntaxKind(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (node.kind === kind) return true;
  let found = false;
  ts.forEachChild(node, (child) => { if (!found && containsSyntaxKind(child, kind)) found = true; });
  return found;
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

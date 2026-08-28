import { resolve } from "node:path"
import * as ts from "typescript-js"
import type { CompiledFlow } from "./authoring.ts"
import { encodePlanArtifact, loadCompiledFlow, validatePlanTemplate } from "./artifact.ts"
import { deriveEffectManifest, type EffectManifest, EffectManifestFailure } from "./effect-manifest.ts"
import {
  canonicalJson,
  derivedSchema,
  digest,
  expressionDependencies,
  fanOutSteps,
  structuralSchema,
  type ActionDescriptor,
  type ActionNode,
  type BranchNode,
  type ChildFlowNode,
  type DurableSchema,
  type DurableTypeDescriptor,
  type FanOutNode,
  type FanOutStep,
  type FanOutTemplateExpr,
  type JsonValue,
  type LoopNode,
  type LoopTemplateExpr,
  type PlanFragment,
  type PlanNode,
  type PlanTemplate,
  type QueueNode,
  queueContractIdentity,
  type SignalNode,
  signalContractIdentity,
  type StructuralDurableSchema,
  type TimerNode,
  type ValueExpr
} from "./ir.ts"
import {
  actionDeclarationFromDescriptor,
  deriveActionContract,
  deriveDurableValueSchema,
  descriptorTypeScript,
  type DurableFailureIdentityCollision,
  failureIdentityCollisionOf,
  validateActionContractDescriptor
} from "./schema.ts"

const PROJECT_ROOT = "/smithers-durable-source-compiler"

/**
 * The sentence `SMITHERS4124` carries, kept in one place because the Go bridge
 * emits the same text.
 *
 * It names both classes and the identity they share, which is the whole point
 * of the code existing: before it, this program was refused with
 * `SMITHERS4112`, "higher-order and dynamic calls are unavailable in durable
 * source lowering" — a true sentence about a different program, reached by
 * falling through the tail of `lowerExpression`, and one that sends an author
 * hunting for a higher-order call that is not there.
 *
 * The pair arrives sorted (see {@link DurableFailureIdentityCollision}), so the
 * text does not depend on union enumeration order and the two backends agree
 * without either one having to reproduce the other's traversal.
 */
const durableFailureIdentityCollisionMessage = (
  collision: DurableFailureIdentityCollision
): string =>
  `Error classes ${collision.classNames[0]} and ${collision.classNames[1]} in this Action's declared ` +
  `failure channel share one durable failure identity ${collision.identity}; a decoder on the far side of a ` +
  `persistence boundary selects a handler by identity, so these two classes cannot be told apart on the ` +
  `wire — rename one of them or declare it in its own module`

const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_FAN_OUT_STEPS = 16
const MAX_CHILD_FLOW_DEPTH = 8
const MAX_LOOP_ROUNDS = 1000

export interface DurableSourceActionBinding {
  /** Exact module specifier used by authored source. */
  readonly moduleSpecifier: string
  /** Exact exported value. Local import aliases are resolved by the checker. */
  readonly exportName: string
  /** Compiler-emitted structural contract; legacy JSON-stub descriptors remain readable. */
  readonly descriptor: ActionDescriptor
}

/**
 * A statically resolvable, previously compiled durable Flow made invocable as
 * a child boundary. The provisional source spelling is `Exported.run(input)`;
 * the embedded, digest-pinned child Plan is the durable contract.
 */
export interface DurableSourceFlowBinding {
  /** Exact module specifier used by authored source. */
  readonly moduleSpecifier: string
  /** Exact exported value. Local import aliases are resolved by the checker. */
  readonly exportName: string
  /** Complete validated child Plan; it must carry structural Flow schemas. */
  readonly plan: PlanTemplate
  /**
   * The child's own Effect Manifest, when the caller has one.
   *
   * A parent's effect set is **transitive**: `lowerChildFlowCall` copies every
   * one of the child Plan's Actions into the parent's `usedActions`, so the
   * parent Plan's requirement row already names them and deployment closure
   * depends on that. A parent Manifest therefore has to name them too — and it
   * has to learn them from the child's *Manifest*, not from the child's Plan,
   * because after the pivot the child publishes no Plan.
   *
   * When it is absent the parent's Manifest derivation fails closed rather than
   * publishing a requirement row that silently omits the child's Actions.
   */
  readonly manifest?: EffectManifest
}

export interface DurableSourceCompileOptions {
  readonly fileName?: string
  readonly flowId?: string
  readonly flowVersion?: number
  /**
   * Contracts for Actions this source *imports* from other modules, which this
   * single-source pass cannot see. Actions declared in the compiled source
   * itself are derived from the checked program and need no binding, so this is
   * optional and empty is the ordinary case for a self-contained module.
   */
  readonly actions?: readonly DurableSourceActionBinding[]
  readonly flows?: readonly DurableSourceFlowBinding[]
}

/**
 * One `class X extends Action<Signature>` declaration the compiler consumed
 * from the compiled source. A consumer that lowers the durable call must erase
 * these declarations along with the compiler-owned import: their contract has
 * been captured in the Plan and their base class does not exist at runtime.
 * Offsets are zero-based UTF-16 indices into the authored source and cover the
 * whole declaration, including any modifiers.
 */
export interface DurableSourceDerivedAction {
  /** Declared class name. */
  readonly name: string
  /** Derived contract id, `<authored file>#<name>`. */
  readonly id: string
  readonly start: number
  readonly end: number
}

export interface DurableSourceDiagnostic {
  readonly code: string
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly length: number
}

export interface DurableSourceCompileSuccess {
  readonly ok: true
  readonly diagnostics: readonly []
  readonly plan: PlanTemplate
  readonly artifact: Uint8Array
  readonly flow: CompiledFlow<unknown, unknown>
  /** Compiler-owned Action declarations consumed from the compiled source. */
  readonly derivedActions: readonly DurableSourceDerivedAction[]
  /**
   * The Flow's **Effect Manifest**, emitted as a second artifact beside the
   * Plan (`docs/DECISIONS.md` §PR-1, pending ratification).
   *
   * Derived by `effect-manifest.ts` from the same checked source this Plan was
   * lowered from, by its own syntactic descent. It is NOT projected out of
   * `plan` — a Manifest that could only be projected out of a Plan would
   * validate nothing about a world with no Plan in it.
   *
   * `undefined` when derivation itself failed. That is a fail-OPEN here on
   * purpose: this field is new, nothing existing may change because of it, and
   * a Manifest defect must never turn an accepted Plan into a diagnostic. The
   * fail-CLOSED half lives in the cross-check, which refuses an absent
   * Manifest and prints `manifestFailure`.
   */
  readonly manifest: EffectManifest | undefined
  /** Why {@link manifest} is absent, when it is. */
  readonly manifestFailure: string | undefined
}

export interface DurableSourceCompileFailure {
  readonly ok: false
  readonly diagnostics: readonly DurableSourceDiagnostic[]
}

export type DurableSourceCompileResult = DurableSourceCompileSuccess | DurableSourceCompileFailure

class LoweringFailure extends Error {
  constructor(readonly diagnostic: DurableSourceDiagnostic) {
    super(diagnostic.message)
    this.name = "LoweringFailure"
  }
}

interface CheckedSource {
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
  readonly durableSymbol: ts.Symbol
  readonly sleepSymbol: ts.Symbol
  readonly signalSymbol: ts.Symbol
  readonly fanOutSymbol: ts.Symbol
  readonly sequentialSymbol: ts.Symbol
  readonly loopSymbol: ts.Symbol
  readonly queueSymbol: ts.Symbol
  readonly broadcastSymbol: ts.Symbol
  readonly actionsBySymbol: ReadonlyMap<ts.Symbol, ActionDescriptor>
  /**
   * Same-file Action declarations whose contract could not be derived because
   * two Error classes in their failure channel mint one durable identity.
   *
   * Disjoint from `actionsBySymbol` by construction: an entry here exists only
   * where derivation threw, so no descriptor was recorded. It is consulted at
   * the authored `run` call, which is where the reference has always reported
   * an undescribable Action, so the position does not move — only the code and
   * the sentence do.
   */
  readonly collidingActionsBySymbol: ReadonlyMap<ts.Symbol, DurableFailureIdentityCollision>
  /**
   * The compiler-owned `Action` base class.
   *
   * The lowerer never needed it: a `run` call on an Action it could not
   * describe simply found no descriptor and fell through to the generic
   * unsupported-call diagnostic, so "this is an Action" and "this is not a
   * call I lower" were the same answer. The Effect Manifest needs to tell
   * them apart, because *silently omitting* an Action from a set that claims
   * to be reachability-sound is a fail-open, while refusing the program is
   * allowed (`DECISIONS.md` §PR-1: "MUST either be rejected inside a Flow body
   * or force the Manifest to include the full effect set … it MUST NOT
   * silently narrow the Manifest").
   */
  readonly actionBaseSymbol: ts.Symbol
  readonly flowsBySymbol: ReadonlyMap<ts.Symbol, PlanTemplate>
  /** Child Manifests, for the transitive half of the parent's effect set. */
  readonly childManifestsBySymbol: ReadonlyMap<ts.Symbol, EffectManifest>
  readonly derivedActions: readonly DurableSourceDerivedAction[]
  readonly sourceDiagnostics: readonly ts.Diagnostic[]
}

type ModuleExport =
  | { readonly kind: "action"; readonly descriptor: ActionDescriptor }
  | { readonly kind: "flow"; readonly plan: PlanTemplate }

interface NormalizedModuleBinding {
  readonly moduleSpecifier: string
  readonly exportName: string
  readonly export: ModuleExport
  readonly virtualPath: string
}

/**
 * The caller's file identity with path traversal removed. Derived Action ids
 * are anchored here rather than on the TypeScript-normalized name, so an Action
 * declared in `orders.sm` keeps the id `orders.sm#Lookup` that every other
 * compiler for this language derives for it.
 */
const authoredLogicalName = (name: string | undefined): string => {
  const candidate = (name ?? "durable-source.ts").replace(/\\/g, "/")
  const parts = candidate.split("/").filter((part) => part !== "" && part !== "." && part !== "..")
  return parts.join("/") || "durable-source.ts"
}

const normalizeLogicalFileName = (name: string | undefined): string => {
  const normalized = authoredLogicalName(name)
  return /\.[cm]?tsx?$/.test(normalized) ? normalized : `${normalized}.ts`
}

const canonicalSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
  if (symbol === undefined) return undefined
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

const symbolAtExpression = (checker: ts.TypeChecker, expression: ts.Expression): ts.Symbol | undefined => {
  if (ts.isPropertyAccessExpression(expression)) {
    return canonicalSymbol(checker, checker.getSymbolAtLocation(expression.name))
  }
  return canonicalSymbol(checker, checker.getSymbolAtLocation(expression))
}

/**
 * The local an identifier reads, not the property it may also declare.
 *
 * In `{ approval }` the identifier's own symbol is the object literal's
 * property, so asking for it directly loses the binding the shorthand actually
 * reads and every shorthand field looks like an uncapturable free variable.
 */
const readSymbolAt = (checker: ts.TypeChecker, identifier: ts.Identifier): ts.Symbol | undefined => {
  const parent = identifier.parent
  if (parent !== undefined && ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
    return checker.getShorthandAssignmentValueSymbol(parent)
  }
  return checker.getSymbolAtLocation(identifier)
}

const isTypeOnlyReference = (checker: ts.TypeChecker, expression: ts.Expression): boolean => {
  if (ts.isPropertyAccessExpression(expression) && isTypeOnlyReference(checker, expression.expression)) return true
  const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression
  const symbol = checker.getSymbolAtLocation(location)
  if (symbol === undefined || !(symbol.flags & ts.SymbolFlags.Alias)) return false
  return (symbol.declarations ?? []).some((declaration) => {
    if (ts.isImportSpecifier(declaration)) {
      return declaration.isTypeOnly || declaration.parent.parent.isTypeOnly
    }
    if (ts.isNamespaceImport(declaration)) return declaration.parent.isTypeOnly
    if (ts.isImportClause(declaration)) return declaration.isTypeOnly
    return false
  })
}

const symbolIsAssigned = (checked: CheckedSource, symbol: ts.Symbol): boolean => {
  const targetContainsSymbol = (target: ts.Node): boolean => {
    let found = false
    const visit = (node: ts.Node): void => {
      if (found) return
      if (ts.isIdentifier(node) && checked.checker.getSymbolAtLocation(node) === symbol) {
        found = true
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(target)
    return found
  }
  let assigned = false
  const visit = (node: ts.Node): void => {
    if (assigned) return
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      targetContainsSymbol(node.left)
    ) {
      assigned = true
      return
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      targetContainsSymbol(node.operand)
    ) {
      assigned = true
      return
    }
    if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && targetContainsSymbol(node.initializer)) {
      assigned = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(checked.sourceFile)
  return assigned
}

const diagnosticAt = (
  logicalFileName: string,
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  code: string,
  message: string
): DurableSourceDiagnostic => {
  const start = node?.getStart(sourceFile) ?? 0
  const position = sourceFile.getLineAndCharacterOfPosition(start)
  return Object.freeze({
    code,
    message,
    file: logicalFileName,
    line: position.line + 1,
    column: position.character + 1,
    length: Math.max(1, node?.getWidth(sourceFile) ?? 1)
  })
}

const flowDeclarationFromPlan = (exportName: string, plan: PlanTemplate): string => {
  const schemas = plan.flowSchemas
  if (schemas === undefined || schemas.input.shape !== "structural" || schemas.success.shape !== "structural") {
    // checkedSource rejects such bindings before declaration synthesis.
    return `export declare const ${exportName}: { run(input: never): never };`
  }
  return `export declare const ${exportName}: { run(input: ${descriptorTypeScript(schemas.input.descriptor)}): ${descriptorTypeScript(schemas.success.descriptor)} };`
}

const syntheticDeclarationFor = (exports: ReadonlyMap<string, ModuleExport>): string =>
  [...exports.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, moduleExport]) => moduleExport.kind === "action"
      ? actionDeclarationFromDescriptor(name, moduleExport.descriptor)
      : flowDeclarationFromPlan(name, moduleExport.plan))
    .join("\n")

const moduleExportDigest = (moduleExport: ModuleExport): string =>
  moduleExport.kind === "action" ? digest(moduleExport.descriptor) : moduleExport.plan.digest

/**
 * The compiler-owned `Result` this language already gives every module. It is
 * global here for the same reason it is global in authored source: an Action
 * signature spells `Result<Success, Failure>` without importing it.
 */
const RESULT_PRELUDE = `
interface Result<A, E extends Error> {
  readonly __smithersResult: { readonly success: A; readonly error: E }
}
`

/**
 * The compiler-owned `Action` base. `run` is typed from the subclass's own
 * declared signature through its constructor type, so `Lookup.run(input)` is
 * checked against the authored contract exactly the way a caller-supplied
 * descriptor binding's synthesized declaration is. The phantom member is what
 * carries the signature into the instance type where inference can reach it;
 * it is confined to this compiler-owned virtual module.
 */
const ACTION_DECLARATION = [
  "type SmithersActionSignature<Self> =",
  "  Self extends { prototype: { readonly __smithersActionSignature: infer Signature } } ? Signature : never;",
  "type SmithersActionInput<Self> =",
  "  SmithersActionSignature<Self> extends (input: infer Input) => unknown ? Input : never;",
  "type SmithersActionReturn<Self> =",
  "  SmithersActionSignature<Self> extends (input: never) => infer Returned ? Returned : never;",
  "type SmithersAwaited<Returned> = Returned extends Promise<infer Inner> ? Inner : Returned;",
  "type SmithersActionSuccess<Self> =",
  "  SmithersAwaited<SmithersActionReturn<Self>> extends",
  "    { readonly __smithersResult: { readonly success: infer Success } } ? Success : never;",
  "export declare abstract class Action<Signature extends (input: never) => unknown> {",
  "  readonly __smithersActionSignature: Signature;",
  // The standalone durable checker has no Smithers semantic type hook. Its
  // compiler-owned declaration therefore presents Action.run as the success
  // type plus undefined: upstream TypeScript removes only that sentinel at a
  // postfix `!`, while the durable lowerer below still validates the operand
  // by the Action binding's checker identity before emitting Plan IR.
  "  static run<Self>(this: Self, input: SmithersActionInput<Self>): SmithersActionSuccess<Self> | undefined;",
  "}"
].join("\n")

const checkedSource = (
  source: string,
  logicalFileName: string,
  actionIdPrefix: string,
  rawBindings: readonly DurableSourceActionBinding[],
  rawFlowBindings: readonly DurableSourceFlowBinding[]
): CheckedSource => {
  // Keep caller-controlled logical paths in a separate subtree so a file named
  // like one of our declarations cannot replace a compiler-owned intrinsic.
  const mainPath = resolve(PROJECT_ROOT, "__input__", logicalFileName)
  const flowsPath = resolve(PROJECT_ROOT, "__virtual__/flows.d.ts")
  const resultPath = resolve(PROJECT_ROOT, "__virtual__/result.d.ts")
  const normalizedBindings: NormalizedModuleBinding[] = []
  const childManifestsByExport = new Map<string, EffectManifest>()
  const modules = new Map<string, { path: string; exports: Map<string, ModuleExport> }>()
  const bindExport = (
    index: number,
    label: "Action" | "Flow",
    moduleSpecifier: string,
    exportName: string,
    moduleExport: ModuleExport
  ): void => {
    if (typeof moduleSpecifier !== "string" || moduleSpecifier.trim() === "") {
      throw new TypeError(`${label} binding ${index} needs a non-empty module specifier`)
    }
    if (moduleSpecifier === "smithers:flows") {
      throw new TypeError(`${label} bindings cannot replace the compiler-owned smithers:flows module`)
    }
    if (!/^[$A-Z_a-z][$0-9A-Z_a-z]*$/.test(exportName)) {
      throw new TypeError(`${label} binding ${index} has unsupported export name ${JSON.stringify(exportName)}`)
    }
    let module = modules.get(moduleSpecifier)
    if (module === undefined) {
      module = {
        path: resolve(PROJECT_ROOT, `__virtual__/actions-${modules.size}.d.ts`),
        exports: new Map()
      }
      modules.set(moduleSpecifier, module)
    }
    const existing = module.exports.get(exportName)
    if (existing !== undefined && moduleExportDigest(existing) !== moduleExportDigest(moduleExport)) {
      throw new TypeError(`Conflicting descriptor bindings for ${moduleSpecifier}#${exportName}`)
    }
    module.exports.set(exportName, moduleExport)
    normalizedBindings.push({
      moduleSpecifier,
      exportName,
      export: moduleExport,
      virtualPath: module.path
    })
  }
  for (const [index, binding] of rawBindings.entries()) {
    bindExport(index, "Action", binding.moduleSpecifier, binding.exportName, {
      kind: "action",
      descriptor: validateActionContractDescriptor(binding.descriptor)
    })
  }
  for (const [index, binding] of rawFlowBindings.entries()) {
    const plan = validatePlanTemplate(binding.plan)
    const schemas = plan.flowSchemas
    if (schemas === undefined || schemas.input.shape !== "structural" || schemas.success.shape !== "structural") {
      throw new TypeError(
        `Flow binding ${index} (${plan.flowId}) requires compiler-derived structural Flow input/success schemas`
      )
    }
    bindExport(index, "Flow", binding.moduleSpecifier, binding.exportName, { kind: "flow", plan })
    // Kept beside the binding table rather than inside `ModuleExport`, so the
    // synthesized declaration text and `moduleExportDigest` — which decide the
    // checked program and the conflict rule — are byte-for-byte what they were.
    if (binding.manifest !== undefined) {
      childManifestsByExport.set(`${binding.moduleSpecifier}#${binding.exportName}`, binding.manifest)
    }
  }

  const virtualSources = new Map<string, string>([
    [mainPath, source],
    [resultPath, RESULT_PRELUDE],
    [flowsPath, [
      ACTION_DECLARATION,
      "export declare function durable<Function>(source: Function): unknown;",
      "export declare function sleep(milliseconds: number): null;",
      "/** Provisional source spelling; the compiler-owned Plan contract is normative for this POC. */",
      "export declare function waitSignal<Payload>(identity: string): Payload;",
      "export declare function fanOut<Item>(items: readonly Item[], key: (item: Item) => unknown, body: (item: Item) => unknown): readonly unknown[];",
      "/** Provisional explicit sequencing intrinsic: a durable control edge without a data edge. */",
      "export declare function sequential<First, Second>(first: First, second: Second): readonly [First, Second];",
      "/** Provisional round-budgeted while-style loop template; each round's Action success becomes the next state. */",
      "export declare function loopWhile<State>(initial: State, condition: (state: State) => boolean, body: (state: State) => State | undefined, maxRounds: number): State;",
      "/** Provisional durable queue consumer; suspends until one item is available and consumes exactly it. */",
      "export declare function dequeue<Item>(queue: string): Item;",
      "/** Provisional broadcast wait; one delivery satisfies every already-subscribed execution. */",
      "export declare function waitBroadcast<Payload>(identity: string): Payload;"
    ].join("\n")],
    ...[...modules.values()].map((module) => [
      module.path,
      syntheticDeclarationFor(module.exports)
    ] as const)
  ])
  const modulePaths = new Map<string, string>([["smithers:flows", flowsPath]])
  for (const [moduleSpecifier, module] of modules) modulePaths.set(moduleSpecifier, module.path)
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: []
  }
  const host = ts.createCompilerHost(compilerOptions, true)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const originalFileExists = host.fileExists.bind(host)
  const originalReadFile = host.readFile.bind(host)
  const originalDirectoryExists = host.directoryExists?.bind(host)
  const originalRealpath = host.realpath?.bind(host)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = virtualSources.get(resolve(fileName))
    return text === undefined
      ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(resolve(fileName), text, languageVersion, true, ts.ScriptKind.TS)
  }
  host.fileExists = (fileName) => virtualSources.has(resolve(fileName)) || originalFileExists(fileName)
  host.readFile = (fileName) => virtualSources.get(resolve(fileName)) ?? originalReadFile(fileName)
  host.directoryExists = (directoryName) =>
    resolve(directoryName).startsWith(PROJECT_ROOT) || Boolean(originalDirectoryExists?.(directoryName))
  host.realpath = (fileName) => virtualSources.has(resolve(fileName))
    ? resolve(fileName)
    : (originalRealpath?.(fileName) ?? resolve(fileName))
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    const virtualPath = modulePaths.get(moduleName)
    if (virtualPath !== undefined) {
      return {
        resolvedFileName: virtualPath,
        extension: ts.Extension.Dts,
        isExternalLibraryImport: true
      }
    }
    return ts.resolveModuleName(moduleName, containingFile, compilerOptions, host).resolvedModule
  })
  const program = ts.createProgram([...virtualSources.keys()], compilerOptions, host)
  const sourceFile = program.getSourceFile(mainPath)
  const flowsFile = program.getSourceFile(flowsPath)
  const resultFile = program.getSourceFile(resultPath)
  if (sourceFile === undefined || flowsFile === undefined || resultFile === undefined) {
    throw new Error("Durable source compiler failed to create virtual source files")
  }
  const checker = program.getTypeChecker()
  const durableDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "durable")
  const sleepDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "sleep")
  const signalDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "waitSignal")
  const fanOutDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "fanOut")
  const sequentialDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "sequential")
  const loopDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "loopWhile")
  const queueDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "dequeue")
  const broadcastDeclaration = flowsFile.statements
    .filter(ts.isFunctionDeclaration)
    .find((declaration) => declaration.name?.text === "waitBroadcast")
  const durableSymbol = durableDeclaration?.name && checker.getSymbolAtLocation(durableDeclaration.name)
  const sleepSymbol = sleepDeclaration?.name && checker.getSymbolAtLocation(sleepDeclaration.name)
  const signalSymbol = signalDeclaration?.name && checker.getSymbolAtLocation(signalDeclaration.name)
  const fanOutSymbol = fanOutDeclaration?.name && checker.getSymbolAtLocation(fanOutDeclaration.name)
  const sequentialSymbol = sequentialDeclaration?.name && checker.getSymbolAtLocation(sequentialDeclaration.name)
  const loopSymbol = loopDeclaration?.name && checker.getSymbolAtLocation(loopDeclaration.name)
  const queueSymbol = queueDeclaration?.name && checker.getSymbolAtLocation(queueDeclaration.name)
  const broadcastSymbol = broadcastDeclaration?.name && checker.getSymbolAtLocation(broadcastDeclaration.name)
  if (
    durableSymbol === undefined || sleepSymbol === undefined || signalSymbol === undefined ||
    fanOutSymbol === undefined || sequentialSymbol === undefined || loopSymbol === undefined ||
    queueSymbol === undefined || broadcastSymbol === undefined
  ) {
    throw new Error("Durable source compiler failed to bind its compiler-owned intrinsics")
  }
  // The same binding `deriveSameFileActions` makes for itself, read once here
  // so the Effect Manifest can distinguish "an Action whose contract could not
  // be derived" from "not an Action at all". Nothing about the Plan reads it.
  const actionBaseDeclaration = flowsFile.statements.find(ts.isClassDeclaration)
  const actionBaseSymbol = actionBaseDeclaration?.name && checker.getSymbolAtLocation(actionBaseDeclaration.name)
  if (actionBaseSymbol === undefined) {
    throw new Error("Durable source compiler failed to bind its compiler-owned Action base class")
  }
  const actionsBySymbol = new Map<ts.Symbol, ActionDescriptor>()
  const collidingActionsBySymbol = new Map<ts.Symbol, DurableFailureIdentityCollision>()
  const flowsBySymbol = new Map<ts.Symbol, PlanTemplate>()
  const childManifestsBySymbol = new Map<ts.Symbol, EffectManifest>()
  const derivedActions = deriveSameFileActions(
    program,
    checker,
    sourceFile,
    flowsFile,
    resultFile,
    actionIdPrefix,
    actionsBySymbol,
    collidingActionsBySymbol
  )
  for (const binding of normalizedBindings) {
    const moduleFile = program.getSourceFile(binding.virtualPath)
    const declaration = moduleFile?.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === binding.exportName)
    const symbol = declaration && checker.getSymbolAtLocation(declaration.name)
    if (symbol === undefined) throw new Error(`Durable source compiler failed to bind ${binding.exportName}`)
    if (binding.export.kind === "action") actionsBySymbol.set(symbol, binding.export.descriptor)
    else {
      flowsBySymbol.set(symbol, binding.export.plan)
      const childManifest = childManifestsByExport.get(`${binding.moduleSpecifier}#${binding.exportName}`)
      if (childManifest !== undefined) childManifestsBySymbol.set(symbol, childManifest)
    }
  }
  // The checker may recover a duplicate local/import declaration as the
  // imported symbol. Reject those invalid programs before trusting identity.
  const declarationConflictCodes = new Set([
    2300, 2395, 2440, 2451,
    // Structural Action declarations make these ordinary checker failures a
    // durable contract error before Plan IR can be emitted.
    2322, 2339, 2345, 2353, 2741
  ])
  const sourceDiagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile)
      .filter((diagnostic) => declarationConflictCodes.has(diagnostic.code))
  ].sort((left, right) => (left.start ?? 0) - (right.start ?? 0) || left.code - right.code)
  return {
    sourceFile,
    checker,
    durableSymbol,
    sleepSymbol,
    signalSymbol,
    fanOutSymbol,
    sequentialSymbol,
    loopSymbol,
    queueSymbol,
    broadcastSymbol,
    actionsBySymbol,
    collidingActionsBySymbol,
    actionBaseSymbol,
    flowsBySymbol,
    childManifestsBySymbol,
    derivedActions,
    sourceDiagnostics
  }
}

/**
 * Derives a durable contract for every `class X extends Action<Signature>`
 * declared in the compiled source, before that declaration is erased.
 *
 * This is what makes the standalone API usable without ceremony: a module that
 * declares its own Actions carries the whole contract in its checked types, so
 * a caller has nothing to hand-feed. Descriptor bindings remain for Actions the
 * source *imports*, whose declarations this single-source pass genuinely cannot
 * see.
 *
 * A declaration whose signature is outside the derivable subset is skipped, not
 * fatal: its `run` calls then find no descriptor and the lowerer reports the
 * ordinary unsupported-call diagnostic against the authored call site, which is
 * a better position than the class declaration.
 *
 * Skipping loses the REASON, and for one member of that set the generic
 * unsupported-call sentence is not merely vague but false: two Error classes in
 * the failure channel that mint one durable identity leave an authored
 * `Pick.run({ ... })` — an ordinary compiler-bound Action call, no higher-order
 * or dynamic call anywhere in the program — refused with "higher-order and
 * dynamic calls are unavailable in durable source lowering". That one reason is
 * therefore carried out in `collidingActionsBySymbol` and re-reported at the
 * same call site as `SMITHERS4124`. The position is unchanged; only the code and
 * the sentence are. Every other skip keeps its existing behaviour on purpose —
 * see `source-compiler.test.ts`, "the durable source compiler weakens an error
 * contract only where the spec allows it", which pins `SMITHERS4112` for a
 * channel spelled `any` and for a structural impostor.
 */
const deriveSameFileActions = (
  program: ts.Program,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  flowsFile: ts.SourceFile,
  resultFile: ts.SourceFile,
  actionIdPrefix: string,
  actionsBySymbol: Map<ts.Symbol, ActionDescriptor>,
  collidingActionsBySymbol: Map<ts.Symbol, DurableFailureIdentityCollision>
): readonly DurableSourceDerivedAction[] => {
  const actionDeclaration = flowsFile.statements.find(ts.isClassDeclaration)
  const resultDeclaration = resultFile.statements.find(ts.isInterfaceDeclaration)
  const actionSymbol = actionDeclaration?.name && checker.getSymbolAtLocation(actionDeclaration.name)
  const resultSymbol = resultDeclaration?.name && checker.getSymbolAtLocation(resultDeclaration.name)
  const errorConstraint = resultDeclaration?.typeParameters?.[1]?.constraint
  const errorName = errorConstraint && ts.isTypeReferenceNode(errorConstraint) ? errorConstraint.typeName : undefined
  const errorSymbol = errorName ? canonicalSymbol(checker, checker.getSymbolAtLocation(errorName)) : undefined
  if (actionSymbol === undefined || resultSymbol === undefined || errorSymbol === undefined) {
    throw new Error("Durable source compiler failed to bind its compiler-owned Action contract types")
  }
  const logicalNameForSource = (file: ts.SourceFile): string =>
    file === sourceFile ? actionIdPrefix : authoredLogicalName(program.getSourceFile(file.fileName)?.fileName ?? file.fileName)
  const derived: DurableSourceDerivedAction[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      const extendsAction = (node.heritageClauses ?? [])
        .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        .flatMap((clause) => [...clause.types])
        .some((base) => canonicalSymbol(checker, checker.getSymbolAtLocation(base.expression)) === actionSymbol)
      if (extendsAction) {
        const name = node.name.text
        const symbol = checker.getSymbolAtLocation(node.name)
        if (symbol !== undefined) {
          try {
            const descriptor = deriveActionContract({
              checker,
              sourceFile,
              declaration: node,
              actionSymbol,
              resultSymbol,
              errorSymbol,
              label: name,
              id: `${actionIdPrefix}#${name}`,
              version: 1,
              logicalNameForSource,
              // A same-file Action may declare the built-in `Error` as its whole
              // failure channel. That is not a nominal payload this compiler can
              // describe, but it must not cost the author the input and success
              // contracts it can describe.
              weakenUnderivableErrors: true
            })
            actionsBySymbol.set(symbol, descriptor)
            derived.push(Object.freeze({
              name,
              id: descriptor.id,
              start: node.getStart(sourceFile, false),
              end: node.getEnd()
            }))
          } catch (failure) {
            // Left undescribed on purpose; see the doc comment above. The one
            // exception is the identity collision, whose reason is kept so the
            // call site can state it.
            const collision = failureIdentityCollisionOf(failure)
            if (collision !== undefined) collidingActionsBySymbol.set(symbol, collision)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return Object.freeze(derived)
}

const unwrapParentheses = (expression: ts.Expression): ts.Expression => {
  let current = expression
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

const isStableScalarKeyType = (type: ts.Type): boolean => {
  if (type.isUnion()) return type.types.length > 0 && type.types.every(isStableScalarKeyType)
  return (type.flags & (
    ts.TypeFlags.String | ts.TypeFlags.StringLiteral |
    ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral |
    ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral
  )) !== 0
}

const findDurableCalls = (checked: CheckedSource): readonly ts.CallExpression[] => {
  const found: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapParentheses(node.expression)
      if (
        !isTypeOnlyReference(checked.checker, callee) &&
        symbolAtExpression(checked.checker, callee) === checked.durableSymbol
      ) {
        found.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(checked.sourceFile)
  return found
}

const resolvedFunction = (
  checked: CheckedSource,
  call: ts.CallExpression,
  fail: (node: ts.Node, code: string, message: string) => never
): ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration => {
  if (
    call.arguments.length !== 1 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
    (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
  ) {
    return fail(call, "SMITHERS4103", "durable(...) requires exactly one statically resolvable function argument")
  }
  const argument = unwrapParentheses(call.arguments[0])
  if (ts.isFunctionExpression(argument) || ts.isArrowFunction(argument)) return argument
  if (!ts.isIdentifier(argument)) {
    return fail(argument, "SMITHERS4103", "durable(...) argument is not an inline or statically resolvable function")
  }
  const symbol = checked.checker.getSymbolAtLocation(argument)
  if (symbol !== undefined && symbolIsAssigned(checked, symbol)) {
    return fail(argument, "SMITHERS4103", "durable(...) function binding is assigned and cannot be resolved statically")
  }
  const declarations = symbol?.declarations ?? []
  const functions = declarations.filter((declaration): declaration is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(declaration) && declaration.body !== undefined)
  const variables = declarations.filter(ts.isVariableDeclaration).flatMap((declaration) => {
    if (
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    ) return []
    const initializer = declaration.initializer && unwrapParentheses(declaration.initializer)
    return initializer && (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) ? [initializer] : []
  })
  const candidates = [...functions, ...variables]
  if (candidates.length !== 1 || candidates[0].getSourceFile() !== checked.sourceFile) {
    return fail(argument, "SMITHERS4103", "durable(...) function must resolve uniquely within the compiled source file")
  }
  return candidates[0]
}

const declarationNameFor = (
  call: ts.CallExpression,
  sourceFunction: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration
): string => {
  if (ts.isVariableDeclaration(call.parent) && ts.isIdentifier(call.parent.name)) return call.parent.name.text
  if (sourceFunction.name !== undefined && ts.isIdentifier(sourceFunction.name)) return sourceFunction.name.text
  return "Flow"
}

const flowErrorSchema = (actions: readonly ActionDescriptor[]): DurableSchema | undefined => {
  if (actions.length === 0) return undefined
  const schemas = actions.map((action) => action.errorSchema)
  if (schemas.some((schema) => schema.shape !== "structural")) return derivedSchema("error")
  const flattened = schemas.flatMap((schema) => {
    const descriptor = (schema as Extract<DurableSchema, { shape: "structural" }>).descriptor
    return descriptor.kind === "union" ? descriptor.variants : [descriptor]
  })
  const unique = new Map(flattened.map((descriptor) => [
    canonicalJson(descriptor as unknown as JsonValue),
    descriptor
  ]))
  const ordered = [...unique.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, descriptor]) => descriptor)
  const descriptor: DurableTypeDescriptor = ordered.length === 1
    ? ordered[0]
    : { kind: "union", variants: ordered }
  return structuralSchema("error", descriptor)
}

const canonicalUnion = (variants: readonly DurableTypeDescriptor[]): DurableTypeDescriptor => {
  const flattened = variants.flatMap((variant) => variant.kind === "union" ? variant.variants : [variant])
  const unique = new Map(flattened.map((variant) => [
    canonicalJson(variant as unknown as JsonValue),
    variant
  ]))
  const ordered = [...unique.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, variant]) => variant)
  return ordered.length === 1 ? ordered[0] : { kind: "union", variants: ordered }
}

/** Lexical environment available inside one fan-out per-item template. */
interface FanOutTemplateEnv {
  readonly itemSymbol: ts.Symbol
  readonly bindings: Map<ts.Symbol, FanOutTemplateExpr>
}

/** Height of a Plan's embedded child tree: 1 for a leaf Plan. */
const childFlowEmbeddingDepth = (plan: PlanTemplate): number => {
  let deepest = 0
  for (const child of plan.childFlows ?? []) {
    deepest = Math.max(deepest, childFlowEmbeddingDepth(child))
  }
  return 1 + deepest
}

const literalDescriptor = (value: JsonValue): DurableTypeDescriptor => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return { kind: "literal", value }
  }
  if (Array.isArray(value)) return { kind: "tuple", items: value.map(literalDescriptor) }
  return {
    kind: "object",
    fields: Object.keys(value).sort().map((name) => ({
      name,
      optional: false,
      value: literalDescriptor(value[name])
    }))
  }
}

/**
 * Why a Flow success descriptor could not be derived.
 *
 * `non-structural` is the ONE cause the legacy-artifact compatibility path in
 * `flowSchemas` may swallow: some schema the walk had to read states no
 * descriptor at all, because it came from a pre-derivation `Action.define`
 * artifact. Nothing about the authored Flow is wrong; the contract is simply
 * weaker than this compiler can describe.
 *
 * `defect` is everything else — a projection the output genuinely does not
 * have, a node the walk cannot find, an Action id absent from the Plan's own
 * action list. These are real refusals and must reach a diagnostic even when
 * the same Flow happens to also use a legacy artifact.
 *
 * Every `fail` site names its cause, so the split cannot silently drift back
 * into "does this Flow contain a legacy Action anywhere".
 *
 * `non-structural` is reachable from exactly four sites, and three of them
 * (Action, fan-out Action, loop Action) look the failing Action up in this
 * Plan's own `actions` first — so recording that cause always implies the
 * action-set guard below is satisfied.
 */
type FlowDescriptorFailureCause = "defect" | "non-structural"

interface FlowDescriptorFailure {
  readonly cause: FlowDescriptorFailureCause
  readonly message: string
}

/**
 * Records one failure and yields a placeholder so the walk can CONTINUE.
 *
 * Aborting on the first failure hides the split this type exists to make:
 * an output that reads a legacy Action's success (a legitimately weak leg,
 * visited first) would mask a genuine projection defect in a sibling leg, so
 * the Flow would still compile with the weaker contract and no diagnostic.
 *
 * The second argument is the REASON only — "projects missing durable field x",
 * never "Flow output projects missing durable field x". The subject is supplied
 * by whoever created the closure (`descriptorWalk` below), because one walk now
 * answers the same question for the Flow output AND for every value a Plan node
 * consumes, and a defect in an Action's input must not say "Flow output".
 */
type FlowDescriptorFail = (cause: FlowDescriptorFailureCause, reason: string) => DurableTypeDescriptor

/**
 * Stands in for a descriptor the walk could not derive. Compared by IDENTITY
 * and never by shape; it can never reach a Plan, because a schema is only
 * built from a walk that recorded no failure at all. Projecting through it
 * yields it again, so one unknowable leg does not manufacture a cascade of
 * downstream "defects" that were never the author's doing.
 */
const unknownDescriptor: DurableTypeDescriptor = Object.freeze({ kind: "null" as const })

/**
 * `canonicalUnion` that keeps an unknown leg unknown instead of folding it into
 * a `null` variant.
 *
 * Belt and braces, and honestly labelled as such: no program was found where
 * dropping this guard changes an outcome, because `canonicalUnion` happens to
 * carry the *same object* through its dedupe map, so the identity check in
 * `projectDescriptor` still fires on the variant. That is an accident of
 * `canonicalUnion`'s implementation, not a property it promises — it dedupes by
 * canonical JSON, and `unknownDescriptor` serializes exactly like a real `null`
 * descriptor, so a `[unknown, real-null]` pair keeps whichever came last. Losing
 * the identity would manufacture a spurious `defect` and refuse a Flow the
 * legacy path should still accept, which is the over-correction direction.
 */
const joinDescriptors = (variants: readonly DurableTypeDescriptor[]): DurableTypeDescriptor =>
  variants.some((variant) => variant === unknownDescriptor) ? unknownDescriptor : canonicalUnion(variants)

const projectDescriptor = (
  descriptor: DurableTypeDescriptor,
  path: readonly string[],
  fail: FlowDescriptorFail
): DurableTypeDescriptor => {
  if (descriptor === unknownDescriptor) return descriptor
  if (path.length === 0) return descriptor
  if (descriptor.kind === "union") {
    return joinDescriptors(descriptor.variants.map((variant) => projectDescriptor(variant, path, fail)))
  }
  const [head, ...tail] = path
  if (descriptor.kind === "object") {
    const field = descriptor.fields.find((candidate) => candidate.name === head)
    if (field === undefined) return fail("defect", `projects missing durable field ${head}`)
    return projectDescriptor(field.value, tail, fail)
  }
  if (descriptor.kind === "tuple" && /^(0|[1-9][0-9]*)$/.test(head)) {
    const item = descriptor.items[Number(head)]
    if (item === undefined) return fail("defect", `projects missing durable tuple index ${head}`)
    return projectDescriptor(item, tail, fail)
  }
  if (descriptor.kind === "array" && /^(0|[1-9][0-9]*)$/.test(head)) {
    return projectDescriptor(descriptor.element, tail, fail)
  }
  return fail("defect", `cannot project ${head} from durable ${descriptor.kind}`)
}

const flowSuccessDescriptor = (
  expression: ValueExpr,
  input: DurableTypeDescriptor,
  nodes: readonly PlanNode[],
  actions: readonly ActionDescriptor[],
  childFlows: ReadonlyMap<string, PlanTemplate>,
  fail: FlowDescriptorFail
): DurableTypeDescriptor => {
  switch (expression.kind) {
    case "literal": return literalDescriptor(expression.value)
    case "input": return projectDescriptor(input, expression.path, fail)
    case "node": {
      const findNode = (fragmentNodes: readonly PlanNode[]): PlanNode | undefined => {
        for (const candidate of fragmentNodes) {
          if (candidate.id === expression.nodeId) return candidate
          if (candidate.kind === "branch") {
            const nested = findNode([...candidate.whenTrue.nodes, ...candidate.whenFalse.nodes])
            if (nested !== undefined) return nested
          }
        }
        return undefined
      }
      const node = findNode(nodes)
      if (node?.kind === "action") {
        const action = actions.find((candidate) => candidate.id === node.actionId)
        if (action === undefined) {
          return fail("defect", `references Action ${node.actionId}, which this Plan does not declare`)
        }
        if (action.successSchema.shape !== "structural") {
          return fail("non-structural", `references an Action without a structural success descriptor`)
        }
        return projectDescriptor(action.successSchema.descriptor, expression.path, fail)
      }
      if (node?.kind === "branch") {
        const joined = joinDescriptors([
          flowSuccessDescriptor(node.whenTrue.output, input, nodes, actions, childFlows, fail),
          flowSuccessDescriptor(node.whenFalse.output, input, nodes, actions, childFlows, fail)
        ])
        return projectDescriptor(joined, expression.path, fail)
      }
      if (node?.kind === "timer") {
        return projectDescriptor({ kind: "null" }, expression.path, fail)
      }
      if (node?.kind === "signal") {
        return projectDescriptor(node.payloadSchema.descriptor, expression.path, fail)
      }
      if (node?.kind === "queue") {
        return projectDescriptor(node.itemSchema.descriptor, expression.path, fail)
      }
      if (node?.kind === "fanout") {
        const steps = fanOutSteps(node)
        const lastStep = steps[steps.length - 1]
        if (lastStep === undefined) {
          return fail("defect", `references a fan-out node with no Action steps`)
        }
        const action = actions.find((candidate) => candidate.id === lastStep.actionId)
        if (action === undefined) {
          return fail(
            "defect",
            `references fan-out Action ${lastStep.actionId}, which this Plan does not declare`
          )
        }
        if (action.successSchema.shape !== "structural") {
          return fail("non-structural", `references a fan-out Action without a structural success descriptor`)
        }
        return projectDescriptor(
          { kind: "array", element: action.successSchema.descriptor },
          expression.path,
          fail
        )
      }
      if (node?.kind === "loop") {
        const action = actions.find((candidate) => candidate.id === node.actionId)
        if (action === undefined) {
          return fail("defect", `references loop Action ${node.actionId}, which this Plan does not declare`)
        }
        if (action.successSchema.shape !== "structural") {
          return fail("non-structural", `references a loop Action without a structural success descriptor`)
        }
        // Zero rounds yields the initial state; otherwise the final round's
        // Action success. The descriptor is their canonical union.
        const joined = joinDescriptors([
          flowSuccessDescriptor(node.initial, input, nodes, actions, childFlows, fail),
          action.successSchema.descriptor
        ])
        return projectDescriptor(joined, expression.path, fail)
      }
      if (node?.kind === "childFlow") {
        const child = childFlows.get(node.planDigest)
        if (child === undefined) {
          return fail("defect", `references child Flow ${node.planDigest}, which this Plan does not embed`)
        }
        const success = child.flowSchemas?.success
        if (success === undefined || success.shape !== "structural") {
          return fail("non-structural", `references a child Flow without a structural success descriptor`)
        }
        return projectDescriptor(success.descriptor, expression.path, fail)
      }
      return fail("defect", `references a node without a supported success descriptor`)
    }
    case "array": return {
      kind: "tuple",
      items: expression.items.map((item) => flowSuccessDescriptor(item, input, nodes, actions, childFlows, fail))
    }
    case "object": return {
      kind: "object",
      fields: Object.keys(expression.fields).sort().map((name) => ({
        name,
        optional: false,
        value: flowSuccessDescriptor(expression.fields[name], input, nodes, actions, childFlows, fail)
      }))
    }
    case "unary": return { kind: "boolean" }
    case "binary": return ["eq", "neq", "gt", "gte", "lt", "lte", "and", "or"].includes(expression.operator)
      ? { kind: "boolean" }
      : expression.operator === "add"
        ? { kind: "number" }
        : { kind: "string" }
  }
}

/**
 * Every value a Plan NODE consumes, paired with the subject a diagnostic about
 * it names. The Flow output is not here: it is walked separately, because its
 * derived descriptor becomes the success schema while these are derived only to
 * be discarded.
 *
 * This exists because the projection rule was half a rule. `flowSuccessDescriptor`
 * refuses `return { count: input.items.length }`, but `Step.run({ key:
 * input.items.length })` reached no descriptor at all: the Plan carried
 * `{"kind":"input","path":["items","length"]}` into the Action's input and
 * `pathValue` faulted with a `ProjectionDefect` at run time. Same expression
 * language, same descriptors, same question — so the same walk answers it,
 * rather than a second walk that would learn a shape this one does not.
 *
 * Branch fragments are descended in `whenTrue` then `whenFalse` order so the
 * traversal is total and deterministic; the switch is exhaustive on `PlanNode`
 * so a new node kind cannot silently opt out of the check.
 */
const planNodeValues = (
  nodes: readonly PlanNode[]
): readonly { readonly subject: string; readonly expression: ValueExpr }[] => {
  const values: { readonly subject: string; readonly expression: ValueExpr }[] = []
  const visit = (fragmentNodes: readonly PlanNode[]): void => {
    for (const node of fragmentNodes) {
      switch (node.kind) {
        case "action":
          values.push({ subject: `Action ${node.actionId} input`, expression: node.input })
          break
        case "childFlow":
          values.push({ subject: `child Flow ${node.flowId} input`, expression: node.input })
          break
        case "timer":
          values.push({ subject: "sleep duration", expression: node.durationMs })
          break
        case "fanout":
          values.push({ subject: "fanOut items", expression: node.items })
          break
        case "loop":
          values.push({ subject: "loopWhile initial state", expression: node.initial })
          break
        case "parallel":
          for (const output of node.outputs) values.push({ subject: "parallel output", expression: output })
          break
        case "branch":
          values.push({ subject: "branch condition", expression: node.condition })
          visit(node.whenTrue.nodes)
          visit(node.whenFalse.nodes)
          break
        case "signal":
        case "queue":
          // A suspension consumes no Plan value; its payload/item schema is the
          // contract and is already pinned into the node's identity.
          break
      }
    }
  }
  visit(nodes)
  return values
}

const flowSchemas = (
  checked: CheckedSource,
  sourceFunction: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration,
  output: ValueExpr,
  nodes: readonly PlanNode[],
  actions: readonly ActionDescriptor[],
  childFlows: ReadonlyMap<string, PlanTemplate>,
  fail: (node: ts.Node, code: string, message: string) => never
): NonNullable<PlanTemplate["flowSchemas"]> => {
  const signature = checked.checker.getSignatureFromDeclaration(sourceFunction)
  const parameter = sourceFunction.parameters[0]
  if (signature === undefined || parameter === undefined) {
    return fail(sourceFunction, "SMITHERS4110", "compiler could not derive the durable Flow signature")
  }
  try {
    const inputType = checked.checker.getTypeAtLocation(parameter)
    const input = deriveDurableValueSchema(
      checked.checker,
      checked.sourceFile,
      parameter,
      inputType,
      "input",
      "Flow input"
    )
    const descriptorWalk = (
      expression: ValueExpr,
      subject: string,
      failures: FlowDescriptorFailure[]
    ): DurableTypeDescriptor => flowSuccessDescriptor(
      expression,
      input.descriptor,
      nodes,
      actions,
      childFlows,
      (cause, reason) => {
        failures.push({ cause, message: `${subject} ${reason}` })
        return unknownDescriptor
      }
    )
    const outputFailures: FlowDescriptorFailure[] = []
    const successDescriptor = descriptorWalk(output, "Flow output", outputFailures)
    // The SAME walk over every value a Plan node consumes. Its descriptors are
    // derived only to answer "can this projection be satisfied" and are then
    // discarded: they are deliberately kept out of `outputFailures`, because
    // the success schema is the OUTPUT's contract. Merging the two lists would
    // let a node input that reads a legacy Action's success push a Flow whose
    // output is perfectly structural onto the weaker compatibility contract,
    // changing its emitted schema and its Plan digest for no authoring reason.
    const nodeInputFailures: FlowDescriptorFailure[] = []
    for (const value of planNodeValues(nodes)) {
      descriptorWalk(value.expression, value.subject, nodeInputFailures)
    }
    // A defect outranks every weak-contract excuse. Gating the compatibility
    // path on the ACTION SET alone — "does this Flow contain any legacy
    // Action" — fails open: a Flow that projects a field its output genuinely
    // does not have compiles with the weaker contract and NO diagnostic, and
    // then faults at run time in `pathValue` as a ProjectionDefect. Only a
    // failure the walk itself attributed to a schema that states no descriptor
    // may be swallowed.
    //
    // Output defects are named BEFORE node-input defects, deliberately: every
    // program that refuses today refuses on an output defect, and it must keep
    // its exact sentence. The addition is strictly narrowing — only a Flow with
    // no output defect can newly refuse — so no already-refused program changes
    // its answer.
    const defect = outputFailures.find((failure) => failure.cause === "defect") ??
      nodeInputFailures.find((failure) => failure.cause === "defect")
    if (defect !== undefined) throw new TypeError(defect.message)
    let success: DurableSchema
    if (outputFailures.length === 0) {
      success = structuralSchema("success", successDescriptor)
    } else if (actions.some((action) => action.successSchema.shape !== "structural")) {
      // Legacy Action.define artifacts remain readable but state their weaker
      // contract explicitly; compiler-derived Action bindings never take this
      // compatibility path.
      success = derivedSchema("success")
    } else {
      throw new TypeError(outputFailures[0].message)
    }
    const error = flowErrorSchema(actions)
    return {
      input,
      success,
      ...(error === undefined ? {} : { error })
    }
  } catch (error) {
    return fail(
      sourceFunction,
      "SMITHERS4110",
      `durable Flow boundary is not structurally encodable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

class FunctionLowerer {
  readonly nodes: PlanNode[] = []
  readonly usedActions = new Map<string, ActionDescriptor>()
  /** Embedded child Plans keyed by their pinned digest. */
  readonly usedChildFlows = new Map<string, PlanTemplate>()
  readonly values = new Map<ts.Symbol, ValueExpr>()
  readonly occurrences = new Map<string, number>()
  readonly nodeIds = new Set<string>()
  readonly fanOutNodeIds = new Set<string>()
  readonly signalIds = new Set<string>()
  /** True once the emitted Plan requires format version 2 features. */
  usesFormatVersion2 = false
  /** True once the emitted Plan requires format version 3 features. */
  usesFormatVersion3 = false
  /** Queue identities used in this Flow, with their derived item contracts. */
  readonly queueContracts = new Map<string, string>()
  private activeNodes: PlanNode[] = this.nodes
  private sequencingDependency: string | undefined

  constructor(
    readonly checked: CheckedSource,
    readonly logicalFileName: string,
    readonly flowId: string,
    readonly flowVersion: number,
    readonly functionName: string,
    readonly fail: (node: ts.Node, code: string, message: string) => never
  ) {}

  lower(sourceFunction: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration): ValueExpr {
    if (sourceFunction.body === undefined || !ts.isBlock(sourceFunction.body)) {
      return this.fail(sourceFunction, "SMITHERS4104", "durable source functions require a block body with an explicit return")
    }
    if (sourceFunction.asteriskToken !== undefined || ts.getModifiers(sourceFunction)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      return this.fail(sourceFunction, "SMITHERS4104", "async and generator durable source functions are outside the bounded lowering subset")
    }
    if (sourceFunction.parameters.length !== 1) {
      return this.fail(sourceFunction, "SMITHERS4104", "durable source functions require exactly one input parameter")
    }
    const parameter = sourceFunction.parameters[0]
    if (!ts.isIdentifier(parameter.name) || parameter.initializer !== undefined || parameter.dotDotDotToken !== undefined) {
      return this.fail(parameter, "SMITHERS4104", "durable input must be one plain identifier without an initializer")
    }
    const inputSymbol = this.checked.checker.getSymbolAtLocation(parameter.name)
    if (inputSymbol === undefined) return this.fail(parameter, "SMITHERS4199", "compiler could not resolve the durable input binding")
    this.values.set(inputSymbol, { kind: "input", path: [] })

    let output: ValueExpr | undefined
    for (const statement of sourceFunction.body.statements) {
      if (output !== undefined) {
        return this.fail(statement, "SMITHERS4109", "statements after the durable return are not supported")
      }
      if (ts.isEmptyStatement(statement)) continue
      if (ts.isVariableStatement(statement)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
          return this.fail(statement, "SMITHERS4105", "durable straight-line bindings must use const")
        }
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
            return this.fail(declaration, "SMITHERS4105", "durable const bindings require one identifier and an initializer")
          }
          const symbol = this.checked.checker.getSymbolAtLocation(declaration.name)
          if (symbol === undefined) return this.fail(declaration.name, "SMITHERS4199", "compiler could not resolve const binding")
          const expression = this.lowerExpression(declaration.initializer, `const:${declaration.name.text}`)
          this.values.set(symbol, expression)
        }
        continue
      }
      if (ts.isReturnStatement(statement)) {
        if (statement.expression === undefined) return this.fail(statement, "SMITHERS4109", "durable return requires a value")
        output = this.lowerExpression(statement.expression, "return", true)
        continue
      }
      if (ts.isExpressionStatement(statement)) {
        const expression = unwrapParentheses(statement.expression)
        const lowered = ts.isCallExpression(expression)
          ? this.lowerTimerCall(expression, "sleep") ?? this.lowerSequentialCall(expression, "sequential")
          : undefined
        if (lowered !== undefined) continue
        return this.fail(
          statement,
          "SMITHERS4108",
          "only compiler-owned sleep(...) and sequential(...) are supported as durable expression statements"
        )
      }
      if (ts.isIfStatement(statement) || ts.isSwitchStatement(statement)) {
        return this.fail(statement, "SMITHERS4106", "runtime branches require explicit Plan branch lowering, which this subset does not guess")
      }
      if (
        ts.isForStatement(statement) || ts.isForInStatement(statement) || ts.isForOfStatement(statement) ||
        ts.isWhileStatement(statement) || ts.isDoStatement(statement)
      ) {
        return this.fail(statement, "SMITHERS4107", "runtime loops require parameterized Plan templates and are not unrolled by this subset")
      }
      return this.fail(statement, "SMITHERS4108", `unsupported durable statement ${ts.SyntaxKind[statement.kind]}`)
    }
    if (output === undefined) return this.fail(sourceFunction.body, "SMITHERS4109", "durable source function must return a value")
    return output
  }

  private lowerExpression(
    expressionValue: ts.Expression,
    anchor: string,
    allowFinalAction = false
  ): ValueExpr {
    const expression = unwrapParentheses(expressionValue)
    if (ts.isIdentifier(expression)) {
      const symbol = readSymbolAt(this.checked.checker, expression)
      const value = symbol && this.values.get(symbol)
      if (value !== undefined) return value
      return this.fail(expression, "SMITHERS4110", `unsupported runtime capture ${expression.text}; only input and prior const bindings are available`)
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: null }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { kind: "literal", value: expression.text }
    }
    if (ts.isNumericLiteral(expression)) {
      const value = Number(expression.text)
      if (!Number.isFinite(value)) return this.fail(expression, "SMITHERS4111", "non-finite numeric literal is not durable")
      return { kind: "literal", value }
    }
    if (
      ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      const value = -Number(expression.operand.text)
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return this.fail(expression, "SMITHERS4111", "non-canonical numeric literal is not durable")
      }
      return { kind: "literal", value }
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const fields = Object.create(null) as Record<string, ValueExpr>
      for (const property of expression.properties) {
        let name: string
        let initializer: ts.Expression
        if (ts.isPropertyAssignment(property)) {
          name = this.propertyName(property.name)
          initializer = property.initializer
        } else if (ts.isShorthandPropertyAssignment(property)) {
          name = property.name.text
          initializer = property.name
        } else {
          return this.fail(property, "SMITHERS4111", "durable objects do not support spreads, methods, or accessors in this subset")
        }
        if (Object.hasOwn(fields, name)) return this.fail(property, "SMITHERS4111", `duplicate durable object field ${name}`)
        fields[name] = this.lowerExpression(initializer, `${anchor}.${name}`)
      }
      return { kind: "object", fields }
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const items = expression.elements.map((element, index) => {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          return this.fail(element, "SMITHERS4111", "durable arrays cannot contain holes or spreads")
        }
        return this.lowerExpression(element, `${anchor}[${index}]`)
      })
      return { kind: "array", items }
    }
    if (ts.isPropertyAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "SMITHERS4106", "optional projections require explicit Plan branch lowering")
      }
      return this.project(this.lowerExpression(expression.expression, anchor), expression.name.text, expression)
    }
    if (ts.isElementAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "SMITHERS4106", "optional projections require explicit Plan branch lowering")
      }
      const argument = expression.argumentExpression && unwrapParentheses(expression.argumentExpression)
      const key = argument && (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) ? argument.text : undefined
      if (key === undefined) return this.fail(expression, "SMITHERS4111", "durable projection keys must be static string or numeric literals")
      return this.project(this.lowerExpression(expression.expression, anchor), key, expression)
    }
    if (ts.isConditionalExpression(expression)) {
      return this.lowerConditionalExpression(expression, anchor, allowFinalAction)
    }
    if (ts.isNonNullExpression(expression)) {
      const candidate = unwrapParentheses(expression.expression)
      if (ts.isCallExpression(candidate)) {
        const lowered = this.lowerActionCall(candidate, anchor)
        if (lowered !== undefined) {
          this.sequencingDependency = lowered.nodeId
          return lowered
        }
      }
      return this.fail(
        expression,
        "SMITHERS4112",
        "postfix ! is supported only directly on a compiler-bound Action.run(...) Result"
      )
    }
    if (ts.isCallExpression(expression)) {
      const signal = this.lowerSignalCall(expression, anchor)
      if (signal !== undefined) return signal
      const broadcast = this.lowerBroadcastCall(expression, anchor)
      if (broadcast !== undefined) return broadcast
      const queued = this.lowerQueueCall(expression, anchor)
      if (queued !== undefined) return queued
      const fanOut = this.lowerFanOutCall(expression, anchor)
      if (fanOut !== undefined) return fanOut
      const loop = this.lowerLoopCall(expression, anchor)
      if (loop !== undefined) return loop
      const timer = this.lowerTimerCall(expression, anchor)
      if (timer !== undefined) return timer
      const sequenced = this.lowerSequentialCall(expression, anchor)
      if (sequenced !== undefined) return sequenced
      const childFlow = this.lowerChildFlowCall(expression, anchor)
      if (childFlow !== undefined) return childFlow
      const lowered = this.lowerActionCall(expression, anchor)
      if (lowered !== undefined) {
        if (!allowFinalAction) {
          return this.fail(
            expression,
            "SMITHERS4115",
            "an intermediate Action.run(...) must use postfix !; only the final returned Result may remain wrapped"
          )
        }
        return lowered
      }
      return this.fail(expression, "SMITHERS4112", "higher-order and dynamic calls are unavailable in durable source lowering")
    }
    return this.fail(expression, "SMITHERS4111", `unsupported durable expression ${ts.SyntaxKind[expression.kind]}`)
  }

  private lowerSignalCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.signalSymbol
    ) return undefined
    if (
      call.arguments.length !== 1 || call.typeArguments?.length !== 1 ||
      call.questionDotToken !== undefined || (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        "SMITHERS4118",
        "provisional compiler-owned waitSignal<Payload>(\"identity\") requires one explicit payload type and one static identity"
      )
    }
    const identityExpression = unwrapParentheses(call.arguments[0])
    if (!ts.isStringLiteral(identityExpression) && !ts.isNoSubstitutionTemplateLiteral(identityExpression)) {
      return this.fail(
        call.arguments[0],
        "SMITHERS4118",
        "durable signal identity must be a string literal, not a runtime value"
      )
    }
    const signalId = identityExpression.text
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(signalId)) {
      return this.fail(
        identityExpression,
        "SMITHERS4118",
        "durable signal identity must be 1-128 portable characters"
      )
    }
    if (this.signalIds.has(signalId)) {
      return this.fail(identityExpression, "SMITHERS4118", `durable signal identity ${signalId} is duplicated in this Flow`)
    }
    let payloadSchema
    try {
      const typeNode = call.typeArguments[0]
      payloadSchema = deriveDurableValueSchema(
        this.checked.checker,
        this.checked.sourceFile,
        typeNode,
        this.checked.checker.getTypeFromTypeNode(typeNode),
        "input",
        `signal ${signalId} payload`
      )
    } catch (error) {
      return this.fail(
        call.typeArguments[0],
        "SMITHERS4118",
        `durable signal payload is not structurally encodable: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    this.signalIds.add(signalId)
    const signalContractDigest = digest({ signalId, payloadSchema })
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "signal",
      anchor,
      signalId,
      signalContractDigest
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "SMITHERS4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: SignalNode = {
      kind: "signal",
      id,
      signalId,
      payloadSchema,
      signalContractDigest,
      dependencies: [],
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `signal:${signalId}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  /**
   * Shared front half of every compiler-owned single-identity suspension:
   * exactly one explicit payload type argument and one static string identity,
   * with the payload schema derived from the checked type, never from a value.
   */
  private lowerIdentitySuspension(
    call: ts.CallExpression,
    symbol: ts.Symbol,
    code: string,
    what: string,
    spelling: string
  ): { readonly identity: string; readonly schema: StructuralDurableSchema } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== symbol
    ) return undefined
    if (
      call.arguments.length !== 1 || call.typeArguments?.length !== 1 ||
      call.questionDotToken !== undefined || (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        code,
        `provisional compiler-owned ${spelling} requires one explicit type argument and one static identity`
      )
    }
    const identityExpression = unwrapParentheses(call.arguments[0])
    if (!ts.isStringLiteral(identityExpression) && !ts.isNoSubstitutionTemplateLiteral(identityExpression)) {
      return this.fail(call.arguments[0], code, `durable ${what} identity must be a string literal, not a runtime value`)
    }
    const identity = identityExpression.text
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(identity)) {
      return this.fail(identityExpression, code, `durable ${what} identity must be 1-128 portable characters`)
    }
    try {
      const typeNode = call.typeArguments[0]
      return {
        identity,
        schema: deriveDurableValueSchema(
          this.checked.checker,
          this.checked.sourceFile,
          typeNode,
          this.checked.checker.getTypeFromTypeNode(typeNode),
          "input",
          `${what} ${identity} payload`
        )
      }
    } catch (error) {
      return this.fail(
        call.typeArguments[0],
        code,
        `durable ${what} payload is not structurally encodable: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /** Allocates the stable, line-shift tolerant node id for one suspension. */
  private suspensionNodeId(
    call: ts.CallExpression,
    anchor: string,
    kind: string,
    identity: Readonly<Record<string, string>>
  ): string {
    const semantic = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind,
      anchor,
      ...identity
    }
    const occurrenceKey = digest(semantic)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...semantic, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "SMITHERS4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    return id
  }

  private lowerBroadcastCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const lowered = this.lowerIdentitySuspension(
      call,
      this.checked.broadcastSymbol,
      "SMITHERS4122",
      "broadcast signal",
      "waitBroadcast<Payload>(\"identity\")"
    )
    if (lowered === undefined) return undefined
    const { identity: signalId, schema: payloadSchema } = lowered
    if (this.signalIds.has(signalId)) {
      return this.fail(call.arguments[0], "SMITHERS4122", `durable signal identity ${signalId} is duplicated in this Flow`)
    }
    this.signalIds.add(signalId)
    this.usesFormatVersion3 = true
    const signalContractDigest = signalContractIdentity(signalId, payloadSchema, "broadcast")
    const id = this.suspensionNodeId(call, anchor, "signal", {
      signalId,
      signalContractDigest,
      delivery: "broadcast"
    })
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: SignalNode = {
      kind: "signal",
      id,
      signalId,
      payloadSchema,
      signalContractDigest,
      delivery: "broadcast",
      dependencies: [],
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `broadcast:${signalId}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private lowerQueueCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const lowered = this.lowerIdentitySuspension(
      call,
      this.checked.queueSymbol,
      "SMITHERS4123",
      "queue",
      "dequeue<Item>(\"queue.identity\")"
    )
    if (lowered === undefined) return undefined
    const { identity: queueId, schema: itemSchema } = lowered
    const queueContractDigest = queueContractIdentity(queueId, itemSchema)
    // Unlike a signal inbox, several consumers of one queue are legitimate;
    // they must simply agree on one exact item contract.
    const pinned = this.queueContracts.get(queueId)
    if (pinned !== undefined && pinned !== queueContractDigest) {
      return this.fail(
        call.typeArguments![0],
        "SMITHERS4123",
        `durable queue ${queueId} is consumed with two different item types in this Flow`
      )
    }
    this.queueContracts.set(queueId, queueContractDigest)
    this.usesFormatVersion3 = true
    const id = this.suspensionNodeId(call, anchor, "queue", { queueId, queueContractDigest })
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: QueueNode = {
      kind: "queue",
      id,
      queueId,
      itemSchema,
      queueContractDigest,
      dependencies: [],
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `queue:${queueId}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private lowerTimerCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.sleepSymbol
    ) return undefined
    if (
      call.arguments.length !== 1 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
      (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(call, "SMITHERS4116", "compiler-owned sleep(...) requires one statically bound duration argument")
    }
    const durationMs = this.lowerExpression(call.arguments[0], `${anchor}:duration`)
    if (
      durationMs.kind === "literal" &&
      (typeof durationMs.value !== "number" || !Number.isSafeInteger(durationMs.value) || durationMs.value < 0)
    ) {
      return this.fail(
        call.arguments[0],
        "SMITHERS4116",
        "durable sleep duration must be a non-negative safe integer number of milliseconds"
      )
    }
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "timer",
      anchor,
      durationMs
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "SMITHERS4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: TimerNode = {
      kind: "timer",
      id,
      durationMs,
      dependencies: expressionDependencies(durationMs),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: "sleep",
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  /**
   * Provisional compiler-owned `sequential(first, second)`: a durable control
   * edge between two independent Action calls so their order survives restart
   * without inventing a data dependency. Both success values remain available
   * as an ordered tuple.
   */
  private lowerSequentialCall(
    call: ts.CallExpression,
    anchor: string
  ): ValueExpr | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.sequentialSymbol
    ) return undefined
    if (
      call.arguments.length !== 2 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
      (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        "SMITHERS4119",
        "compiler-owned sequential(first, second) requires exactly two direct imported Action.run(...) arguments"
      )
    }
    const lowerArgument = (
      argument: ts.Expression,
      suffix: string
    ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } => {
      const unwrapped = unwrapParentheses(argument)
      const lowered = ts.isCallExpression(unwrapped)
        ? this.lowerActionCall(unwrapped, `${anchor}:${suffix}`)
        : undefined
      if (lowered === undefined) {
        return this.fail(argument, "SMITHERS4119", "sequential(...) arguments must be direct imported Action.run(...) calls")
      }
      return lowered
    }
    const first = lowerArgument(call.arguments[0], "first")
    // The explicit durable control edge: the second Action may not start until
    // the first holds a committed terminal exit, although no data flows.
    this.sequencingDependency = first.nodeId
    const second = lowerArgument(call.arguments[1], "second")
    this.sequencingDependency = second.nodeId
    return { kind: "array", items: [first, second] }
  }

  /**
   * Provisional `ChildFlow.run(input)` lowering for a compiler-bound, already
   * compiled durable Flow. The child Plan is embedded and digest-pinned; the
   * child executes as its own attached execution with its own journal.
   */
  private lowerChildFlowCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    if (
      !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "run" ||
      call.questionDotToken !== undefined || call.expression.questionDotToken !== undefined
    ) return undefined
    const flowReference = unwrapParentheses(call.expression.expression)
    if (isTypeOnlyReference(this.checked.checker, flowReference)) return undefined
    const flowSymbol = symbolAtExpression(this.checked.checker, flowReference)
    const childPlan = flowSymbol && this.checked.flowsBySymbol.get(flowSymbol)
    if (childPlan === undefined) return undefined
    if (call.arguments.length !== 1 || call.typeArguments !== undefined) {
      return this.fail(call, "SMITHERS4120", `${childPlan.flowId}.run requires exactly one input argument in durable source`)
    }
    // Inline recursion is structurally impossible (a Plan cannot embed its own
    // digest), and mutual recursion cannot escape this explicit round budget.
    if (childFlowEmbeddingDepth(childPlan) >= MAX_CHILD_FLOW_DEPTH) {
      return this.fail(
        call,
        "SMITHERS4120",
        `child Flow ${childPlan.flowId} exceeds the child-boundary round budget of ${MAX_CHILD_FLOW_DEPTH}`
      )
    }
    const input = this.lowerExpression(call.arguments[0], `${anchor}:input`)
    for (const candidate of this.usedChildFlows.values()) {
      if (
        candidate.flowId === childPlan.flowId &&
        candidate.flowVersion === childPlan.flowVersion &&
        candidate.digest !== childPlan.digest
      ) {
        return this.fail(
          call,
          "SMITHERS4114",
          `child Flow ${childPlan.flowId}@${childPlan.flowVersion} resolves to incompatible durable Plans`
        )
      }
    }
    // One Action id must carry one exact contract across the embedded tree.
    for (const action of childPlan.actions) {
      const existing = this.usedActions.get(action.id)
      if (existing !== undefined && existing.contractDigest !== action.contractDigest) {
        return this.fail(call, "SMITHERS4114", `Action id ${action.id} resolves to incompatible durable contracts`)
      }
    }
    for (const action of childPlan.actions) this.usedActions.set(action.id, action)
    this.usedChildFlows.set(childPlan.digest, childPlan)
    this.usesFormatVersion2 = true
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "childFlow",
      anchor,
      childFlowId: childPlan.flowId,
      childFlowVersion: childPlan.flowVersion,
      childPlanDigest: childPlan.digest,
      input
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "SMITHERS4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: ChildFlowNode = {
      kind: "childFlow",
      id,
      flowId: childPlan.flowId,
      flowVersion: childPlan.flowVersion,
      planDigest: childPlan.digest,
      input,
      dependencies: expressionDependencies(input),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `childFlow:${childPlan.flowId}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    // A child boundary is an effectful sub-program; later source expressions
    // observe its completion like a propagated Action.
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private inlineFanOutCallback(
    expressionValue: ts.Expression,
    label: "key" | "body",
    allowBlock = false
  ): { readonly itemSymbol: ts.Symbol; readonly body: ts.Expression | ts.Block } {
    const expression = unwrapParentheses(expressionValue)
    if (
      !ts.isArrowFunction(expression) || (!allowBlock && ts.isBlock(expression.body)) ||
      expression.parameters.length !== 1 || expression.typeParameters !== undefined ||
      ts.getModifiers(expression)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      return this.fail(
        expression,
        "SMITHERS4117",
        allowBlock
          ? `durable fanOut ${label} must be one inline, synchronous arrow with one item parameter`
          : `durable fanOut ${label} must be one inline, synchronous expression arrow with one item parameter`
      )
    }
    const parameter = expression.parameters[0]
    if (
      !ts.isIdentifier(parameter.name) || parameter.initializer !== undefined ||
      parameter.dotDotDotToken !== undefined || parameter.questionToken !== undefined
    ) {
      return this.fail(
        parameter,
        "SMITHERS4117",
        `durable fanOut ${label} parameter must be one required item identifier`
      )
    }
    const itemSymbol = this.checked.checker.getSymbolAtLocation(parameter.name)
    if (itemSymbol === undefined) return this.fail(parameter.name, "SMITHERS4199", "compiler could not bind fanOut item")
    return { itemSymbol, body: expression.body }
  }

  private lowerFanOutTemplate(
    expressionValue: ts.Expression,
    env: FanOutTemplateEnv
  ): FanOutTemplateExpr {
    const expression = unwrapParentheses(expressionValue)
    if (ts.isIdentifier(expression)) {
      const symbol = readSymbolAt(this.checked.checker, expression)
      if (symbol === env.itemSymbol) {
        return { kind: "item", path: [] }
      }
      const bound = symbol && env.bindings.get(symbol)
      if (bound !== undefined) return bound
      return this.fail(
        expression,
        "SMITHERS4117",
        `durable fanOut templates cannot capture ${expression.text}; use only the current item, earlier steps, and literals`
      )
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: null }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { kind: "literal", value: expression.text }
    }
    if (ts.isNumericLiteral(expression)) {
      const value = Number(expression.text)
      if (!Number.isFinite(value)) return this.fail(expression, "SMITHERS4117", "fanOut template number is not canonical")
      return { kind: "literal", value }
    }
    if (
      ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      const value = -Number(expression.operand.text)
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return this.fail(expression, "SMITHERS4117", "fanOut template number is not canonical")
      }
      return { kind: "literal", value }
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const fields = Object.create(null) as Record<string, FanOutTemplateExpr>
      for (const property of expression.properties) {
        let name: string
        let initializer: ts.Expression
        if (ts.isPropertyAssignment(property)) {
          name = this.propertyName(property.name)
          initializer = property.initializer
        } else if (ts.isShorthandPropertyAssignment(property)) {
          name = property.name.text
          initializer = property.name
        } else {
          return this.fail(property, "SMITHERS4117", "fanOut input objects do not support spreads, methods, or accessors")
        }
        if (Object.hasOwn(fields, name)) return this.fail(property, "SMITHERS4117", `duplicate fanOut input field ${name}`)
        fields[name] = this.lowerFanOutTemplate(initializer, env)
      }
      return { kind: "object", fields }
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const items = expression.elements.map((element) => {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          return this.fail(element, "SMITHERS4117", "fanOut input arrays cannot contain holes or spreads")
        }
        return this.lowerFanOutTemplate(element, env)
      })
      return { kind: "array", items }
    }
    if (ts.isPropertyAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "SMITHERS4117", "fanOut item keys and inputs cannot use optional projection")
      }
      return this.projectFanOutTemplate(
        this.lowerFanOutTemplate(expression.expression, env),
        expression.name.text,
        expression
      )
    }
    if (ts.isElementAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "SMITHERS4117", "fanOut item keys and inputs cannot use optional projection")
      }
      const argument = expression.argumentExpression && unwrapParentheses(expression.argumentExpression)
      const key = argument && (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) ? argument.text : undefined
      if (key === undefined) return this.fail(expression, "SMITHERS4117", "fanOut item projection keys must be static")
      return this.projectFanOutTemplate(
        this.lowerFanOutTemplate(expression.expression, env),
        key,
        expression
      )
    }
    return this.fail(
      expression,
      "SMITHERS4117",
      `unsupported fanOut template expression ${ts.SyntaxKind[expression.kind]}`
    )
  }

  private projectFanOutTemplate(
    value: FanOutTemplateExpr,
    key: string,
    node: ts.Node
  ): FanOutTemplateExpr {
    if (value.kind === "item") return { kind: "item", path: [...value.path, key] }
    if (value.kind === "step") return { kind: "step", step: value.step, path: [...value.path, key] }
    if (value.kind === "object" && Object.hasOwn(value.fields, key)) return value.fields[key]
    if (value.kind === "array") {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) {
        return this.fail(node, "SMITHERS4117", `cannot project ${JSON.stringify(key)} from this fanOut template`)
      }
      const index = Number(key)
      if (Number.isSafeInteger(index) && index >= 0 && index < value.items.length) return value.items[index]
    }
    if (value.kind === "literal" && value.value !== null && typeof value.value === "object") {
      if (Array.isArray(value.value)) {
        if (!/^(0|[1-9][0-9]*)$/.test(key)) {
          return this.fail(node, "SMITHERS4117", `cannot project ${JSON.stringify(key)} from this fanOut template`)
        }
        const index = Number(key)
        if (Number.isSafeInteger(index) && index >= 0 && index < value.value.length) {
          return { kind: "literal", value: value.value[index] }
        }
      } else if (Object.hasOwn(value.value, key)) {
        return { kind: "literal", value: value.value[key] }
      }
    }
    return this.fail(node, "SMITHERS4117", `cannot project ${JSON.stringify(key)} from this fanOut template`)
  }

  private lowerFanOutCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.fanOutSymbol
    ) return undefined
    if (
      call.arguments.length !== 3 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
      (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        "SMITHERS4117",
        "compiler-owned fanOut(items, item => item.key, item => Action.run(input)) requires exactly three static arguments"
      )
    }

    const items = this.lowerExpression(call.arguments[0], `${anchor}:items`)
    if (expressionDependencies(items).some((dependency) => this.fanOutNodeIds.has(dependency))) {
      return this.fail(call.arguments[0], "SMITHERS4117", "nested fanOut is outside the bounded runtime template subset")
    }
    const keyCallback = this.inlineFanOutCallback(call.arguments[1], "key")
    if (ts.isBlock(keyCallback.body)) {
      return this.fail(keyCallback.body, "SMITHERS4117", "durable fanOut key must be one expression arrow")
    }
    if (!isStableScalarKeyType(this.checked.checker.getTypeAtLocation(keyCallback.body))) {
      return this.fail(
        keyCallback.body,
        "SMITHERS4117",
        "durable fanOut key must statically be a string, number, or boolean"
      )
    }
    const key = this.lowerFanOutTemplate(keyCallback.body, {
      itemSymbol: keyCallback.itemSymbol,
      bindings: new Map()
    })
    if (key.kind !== "item") {
      return this.fail(keyCallback.body, "SMITHERS4117", "durable fanOut key must be a direct projection of the current item")
    }

    const bodyCallback = this.inlineFanOutCallback(call.arguments[2], "body", true)
    const env: FanOutTemplateEnv = { itemSymbol: bodyCallback.itemSymbol, bindings: new Map() }
    const steps = this.lowerFanOutBody(bodyCallback.body, env)
    const stepped = steps.length > 1
    if (stepped) this.usesFormatVersion2 = true

    const stepIdentities = steps.map((step) => ({
      actionId: step.descriptor.id,
      actionVersion: step.descriptor.version,
      actionContractDigest: step.descriptor.contractDigest,
      input: step.input
    }))
    // The single-step encoding stays byte- and identity-stable with the
    // original flat fan-out so existing artifacts and node ids do not churn.
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "fanout",
      anchor,
      items,
      keyPath: key.path,
      ...(stepped
        ? { steps: stepIdentities }
        : {
          actionId: stepIdentities[0]!.actionId,
          actionVersion: stepIdentities[0]!.actionVersion,
          actionContractDigest: stepIdentities[0]!.actionContractDigest,
          input: stepIdentities[0]!.input
        })
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "SMITHERS4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    this.fanOutNodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const shared = {
      id,
      items,
      keyPath: key.path,
      dependencies: expressionDependencies(items),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `fanOut:${stepIdentities.map((step) => step.actionId).join("+")}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    const node: FanOutNode = stepped
      ? { kind: "fanout", ...shared, steps: stepIdentities }
      : {
        kind: "fanout",
        ...shared,
        actionId: stepIdentities[0]!.actionId,
        actionVersion: stepIdentities[0]!.actionVersion,
        actionContractDigest: stepIdentities[0]!.actionContractDigest,
        input: stepIdentities[0]!.input
      }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  /**
   * Lowers a fan-out body into its ordered per-item Action steps. An
   * expression body is exactly one Action.run(template) call. A block body is
   * a bounded straight-line sequence: const bindings that are either pure
   * template projections or `Action.run(template)!` steps, ending with
   * a returned final Action.run(template) call.
   */
  private lowerFanOutBody(
    body: ts.Expression | ts.Block,
    env: FanOutTemplateEnv
  ): readonly { readonly descriptor: ActionDescriptor; readonly input: FanOutTemplateExpr }[] {
    const steps: { descriptor: ActionDescriptor; input: FanOutTemplateExpr }[] = []
    const lowerRun = (expressionValue: ts.Expression, requirePropagation: boolean): number => {
      const expression = unwrapParentheses(expressionValue)
      let runCandidate: ts.Expression = expression
      if (requirePropagation) {
        if (!ts.isNonNullExpression(expression)) {
          return this.fail(
            expressionValue,
            "SMITHERS4117",
            "intermediate fanOut steps must be direct compiler-bound Action.run(...)! expressions"
          )
        }
        runCandidate = unwrapParentheses(expression.expression)
      }
      if (
        !ts.isCallExpression(runCandidate) || !ts.isPropertyAccessExpression(runCandidate.expression) ||
        runCandidate.expression.name.text !== "run" || runCandidate.questionDotToken !== undefined ||
        runCandidate.expression.questionDotToken !== undefined
      ) {
        return this.fail(runCandidate, "SMITHERS4117", "durable fanOut steps must be direct imported Action.run(input) calls")
      }
      const actionReference = unwrapParentheses(runCandidate.expression.expression)
      if (isTypeOnlyReference(this.checked.checker, actionReference)) {
        return this.fail(actionReference, "SMITHERS4117", "fanOut body Action must be a runtime import")
      }
      const actionSymbol = symbolAtExpression(this.checked.checker, actionReference)
      const descriptor = actionSymbol && this.checked.actionsBySymbol.get(actionSymbol)
      if (descriptor === undefined) {
        this.failIfFailureIdentityCollides(actionSymbol, actionReference)
        return this.fail(actionReference, "SMITHERS4117", "fanOut body must target one compiler-bound Action")
      }
      if (runCandidate.arguments.length !== 1 || runCandidate.typeArguments !== undefined) {
        return this.fail(runCandidate, "SMITHERS4117", `${descriptor.id}.run requires exactly one fanOut item input`)
      }
      const input = this.lowerFanOutTemplate(runCandidate.arguments[0], env)
      const prior = this.usedActions.get(descriptor.id)
      if (prior !== undefined && prior.contractDigest !== descriptor.contractDigest) {
        return this.fail(runCandidate, "SMITHERS4114", `Action id ${descriptor.id} resolves to incompatible durable contracts`)
      }
      this.usedActions.set(descriptor.id, descriptor)
      if (steps.length >= MAX_FAN_OUT_STEPS) {
        return this.fail(runCandidate, "SMITHERS4117", `fanOut bodies support at most ${MAX_FAN_OUT_STEPS} Action steps`)
      }
      steps.push({ descriptor, input })
      return steps.length - 1
    }
    if (!ts.isBlock(body)) {
      lowerRun(body, false)
      return steps
    }
    let returned = false
    for (const statement of body.statements) {
      if (returned) {
        return this.fail(statement, "SMITHERS4117", "statements after the fanOut body return are not supported")
      }
      if (ts.isEmptyStatement(statement)) continue
      if (ts.isVariableStatement(statement)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
          return this.fail(statement, "SMITHERS4117", "fanOut body bindings must use const")
        }
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
            return this.fail(declaration, "SMITHERS4117", "fanOut body const bindings require one identifier and an initializer")
          }
          const symbol = this.checked.checker.getSymbolAtLocation(declaration.name)
          if (symbol === undefined) {
            return this.fail(declaration.name, "SMITHERS4199", "compiler could not resolve fanOut body binding")
          }
          const initializer = unwrapParentheses(declaration.initializer)
          if (ts.isNonNullExpression(initializer)) {
            const stepIndex = lowerRun(initializer, true)
            env.bindings.set(symbol, { kind: "step", step: stepIndex, path: [] })
          } else {
            env.bindings.set(symbol, this.lowerFanOutTemplate(declaration.initializer, env))
          }
        }
        continue
      }
      if (ts.isReturnStatement(statement)) {
        if (statement.expression === undefined) {
          return this.fail(statement, "SMITHERS4117", "fanOut body must return its final Action.run(...) call")
        }
        lowerRun(statement.expression, false)
        returned = true
        continue
      }
      return this.fail(statement, "SMITHERS4117", `unsupported fanOut body statement ${ts.SyntaxKind[statement.kind]}`)
    }
    if (!returned) return this.fail(body, "SMITHERS4117", "fanOut body must return its final Action.run(...) call")
    return steps
  }

  private inlineLoopCallback(
    expressionValue: ts.Expression,
    label: "condition" | "body"
  ): { readonly stateSymbol: ts.Symbol; readonly body: ts.Expression } {
    const expression = unwrapParentheses(expressionValue)
    if (
      !ts.isArrowFunction(expression) || ts.isBlock(expression.body) ||
      expression.parameters.length !== 1 || expression.typeParameters !== undefined ||
      ts.getModifiers(expression)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      return this.fail(
        expression,
        "SMITHERS4121",
        `durable loopWhile ${label} must be one inline, synchronous expression arrow with one state parameter`
      )
    }
    const parameter = expression.parameters[0]
    if (
      !ts.isIdentifier(parameter.name) || parameter.initializer !== undefined ||
      parameter.dotDotDotToken !== undefined || parameter.questionToken !== undefined
    ) {
      return this.fail(parameter, "SMITHERS4121", `durable loopWhile ${label} parameter must be one required state identifier`)
    }
    const stateSymbol = this.checked.checker.getSymbolAtLocation(parameter.name)
    if (stateSymbol === undefined) return this.fail(parameter.name, "SMITHERS4199", "compiler could not bind loop state")
    return { stateSymbol, body: expression.body }
  }

  private lowerLoopTemplate(
    expressionValue: ts.Expression,
    stateSymbol: ts.Symbol
  ): LoopTemplateExpr {
    const expression = unwrapParentheses(expressionValue)
    if (ts.isIdentifier(expression)) {
      if (readSymbolAt(this.checked.checker, expression) === stateSymbol) {
        return { kind: "state", path: [] }
      }
      return this.fail(
        expression,
        "SMITHERS4121",
        `durable loop templates cannot capture ${expression.text}; use only the current state and literals`
      )
    }
    if (expression.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: null }
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true }
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return { kind: "literal", value: expression.text }
    }
    if (ts.isNumericLiteral(expression)) {
      const value = Number(expression.text)
      if (!Number.isFinite(value)) return this.fail(expression, "SMITHERS4121", "loop template number is not canonical")
      return { kind: "literal", value }
    }
    if (
      ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(expression.operand)
    ) {
      const value = -Number(expression.operand.text)
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return this.fail(expression, "SMITHERS4121", "loop template number is not canonical")
      }
      return { kind: "literal", value }
    }
    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
      return { kind: "unary", operator: "not", value: this.lowerLoopTemplate(expression.operand, stateSymbol) }
    }
    if (ts.isBinaryExpression(expression)) {
      const operator = this.loopBinaryOperator(expression)
      return {
        kind: "binary",
        operator,
        left: this.lowerLoopTemplate(expression.left, stateSymbol),
        right: this.lowerLoopTemplate(expression.right, stateSymbol)
      }
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const fields = Object.create(null) as Record<string, LoopTemplateExpr>
      for (const property of expression.properties) {
        let name: string
        let initializer: ts.Expression
        if (ts.isPropertyAssignment(property)) {
          name = this.propertyName(property.name)
          initializer = property.initializer
        } else if (ts.isShorthandPropertyAssignment(property)) {
          name = property.name.text
          initializer = property.name
        } else {
          return this.fail(property, "SMITHERS4121", "loop templates do not support spreads, methods, or accessors")
        }
        if (Object.hasOwn(fields, name)) return this.fail(property, "SMITHERS4121", `duplicate loop template field ${name}`)
        fields[name] = this.lowerLoopTemplate(initializer, stateSymbol)
      }
      return { kind: "object", fields }
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const items = expression.elements.map((element) => {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          return this.fail(element, "SMITHERS4121", "loop template arrays cannot contain holes or spreads")
        }
        return this.lowerLoopTemplate(element, stateSymbol)
      })
      return { kind: "array", items }
    }
    if (ts.isPropertyAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "SMITHERS4121", "loop templates cannot use optional projection")
      }
      return this.projectLoopTemplate(
        this.lowerLoopTemplate(expression.expression, stateSymbol),
        expression.name.text,
        expression
      )
    }
    if (ts.isElementAccessExpression(expression)) {
      if (expression.questionDotToken !== undefined) {
        return this.fail(expression, "SMITHERS4121", "loop templates cannot use optional projection")
      }
      const argument = expression.argumentExpression && unwrapParentheses(expression.argumentExpression)
      const key = argument && (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) ? argument.text : undefined
      if (key === undefined) return this.fail(expression, "SMITHERS4121", "loop template projection keys must be static")
      return this.projectLoopTemplate(
        this.lowerLoopTemplate(expression.expression, stateSymbol),
        key,
        expression
      )
    }
    return this.fail(expression, "SMITHERS4121", `unsupported loop template expression ${ts.SyntaxKind[expression.kind]}`)
  }

  private loopBinaryOperator(expression: ts.BinaryExpression): Extract<LoopTemplateExpr, { kind: "binary" }>["operator"] {
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.EqualsEqualsEqualsToken: return "eq"
      case ts.SyntaxKind.ExclamationEqualsEqualsToken: return "neq"
      case ts.SyntaxKind.GreaterThanToken: return "gt"
      case ts.SyntaxKind.GreaterThanEqualsToken: return "gte"
      case ts.SyntaxKind.LessThanToken: return "lt"
      case ts.SyntaxKind.LessThanEqualsToken: return "lte"
      case ts.SyntaxKind.AmpersandAmpersandToken: return "and"
      case ts.SyntaxKind.BarBarToken: return "or"
      case ts.SyntaxKind.PlusToken: {
        const type = this.checked.checker.getTypeAtLocation(expression)
        if ((type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0) return "concat"
        if ((type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0) return "add"
        return this.fail(expression, "SMITHERS4121", "loop template + must be statically number or string")
      }
      default:
        return this.fail(
          expression.operatorToken,
          "SMITHERS4121",
          `unsupported loop template operator ${ts.SyntaxKind[expression.operatorToken.kind]}`
        )
    }
  }

  private projectLoopTemplate(
    value: LoopTemplateExpr,
    key: string,
    node: ts.Node
  ): LoopTemplateExpr {
    if (value.kind === "state") return { kind: "state", path: [...value.path, key] }
    if (value.kind === "object" && Object.hasOwn(value.fields, key)) return value.fields[key]
    if (value.kind === "array") {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) {
        return this.fail(node, "SMITHERS4121", `cannot project ${JSON.stringify(key)} from this loop template`)
      }
      const index = Number(key)
      if (Number.isSafeInteger(index) && index >= 0 && index < value.items.length) return value.items[index]
    }
    if (value.kind === "literal" && value.value !== null && typeof value.value === "object") {
      if (Array.isArray(value.value)) {
        if (!/^(0|[1-9][0-9]*)$/.test(key)) {
          return this.fail(node, "SMITHERS4121", `cannot project ${JSON.stringify(key)} from this loop template`)
        }
        const index = Number(key)
        if (Number.isSafeInteger(index) && index >= 0 && index < value.value.length) {
          return { kind: "literal", value: value.value[index] }
        }
      } else if (Object.hasOwn(value.value, key)) {
        return { kind: "literal", value: value.value[key] }
      }
    }
    return this.fail(node, "SMITHERS4121", `cannot project ${JSON.stringify(key)} from this loop template`)
  }

  /**
   * Provisional compiler-owned
   * `loopWhile(initial, state => condition, state => Action.run(input), maxRounds)`
   * lowering: a runtime-round while template whose per-round Action success
   * becomes the next durable state, with an explicit literal round budget.
   */
  private lowerLoopCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    const callee = unwrapParentheses(call.expression)
    if (
      isTypeOnlyReference(this.checked.checker, callee) ||
      symbolAtExpression(this.checked.checker, callee) !== this.checked.loopSymbol
    ) return undefined
    if (
      call.arguments.length !== 4 || call.typeArguments !== undefined || call.questionDotToken !== undefined ||
      (call.expression.flags & ts.NodeFlags.OptionalChain) !== 0
    ) {
      return this.fail(
        call,
        "SMITHERS4121",
        "compiler-owned loopWhile(initial, state => condition, state => Action.run(input), maxRounds) requires exactly four static arguments"
      )
    }
    const initial = this.lowerExpression(call.arguments[0], `${anchor}:initial`)

    const conditionCallback = this.inlineLoopCallback(call.arguments[1], "condition")
    const isBoolean = (type: ts.Type): boolean =>
      (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0 ||
      (type.isUnion() && type.types.length > 0 && type.types.every(isBoolean))
    if (!isBoolean(this.checked.checker.getTypeAtLocation(conditionCallback.body))) {
      return this.fail(conditionCallback.body, "SMITHERS4121", "durable loopWhile condition must statically be boolean")
    }
    const condition = this.lowerLoopTemplate(conditionCallback.body, conditionCallback.stateSymbol)

    const bodyCallback = this.inlineLoopCallback(call.arguments[2], "body")
    const body = unwrapParentheses(bodyCallback.body)
    if (
      !ts.isCallExpression(body) || !ts.isPropertyAccessExpression(body.expression) ||
      body.expression.name.text !== "run" || body.questionDotToken !== undefined ||
      body.expression.questionDotToken !== undefined
    ) {
      return this.fail(body, "SMITHERS4121", "durable loopWhile body must be exactly one imported Action.run(input) call")
    }
    const actionReference = unwrapParentheses(body.expression.expression)
    if (isTypeOnlyReference(this.checked.checker, actionReference)) {
      return this.fail(actionReference, "SMITHERS4121", "loopWhile body Action must be a runtime import")
    }
    const actionSymbol = symbolAtExpression(this.checked.checker, actionReference)
    const descriptor = actionSymbol && this.checked.actionsBySymbol.get(actionSymbol)
    if (descriptor === undefined) {
      this.failIfFailureIdentityCollides(actionSymbol, actionReference)
      return this.fail(actionReference, "SMITHERS4121", "loopWhile body must target one compiler-bound Action")
    }
    if (body.arguments.length !== 1 || body.typeArguments !== undefined) {
      return this.fail(body, "SMITHERS4121", `${descriptor.id}.run requires exactly one loop state input`)
    }
    const bodyTemplate = this.lowerLoopTemplate(body.arguments[0], bodyCallback.stateSymbol)
    const prior = this.usedActions.get(descriptor.id)
    if (prior !== undefined && prior.contractDigest !== descriptor.contractDigest) {
      return this.fail(body, "SMITHERS4114", `Action id ${descriptor.id} resolves to incompatible durable contracts`)
    }
    this.usedActions.set(descriptor.id, descriptor)

    const budgetExpression = unwrapParentheses(call.arguments[3])
    if (!ts.isNumericLiteral(budgetExpression)) {
      return this.fail(call.arguments[3], "SMITHERS4121", "durable loopWhile round budget must be a static numeric literal")
    }
    const maxRounds = Number(budgetExpression.text)
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_LOOP_ROUNDS) {
      return this.fail(
        budgetExpression,
        "SMITHERS4121",
        `durable loopWhile round budget must be an integer between 1 and ${MAX_LOOP_ROUNDS}`
      )
    }

    this.usesFormatVersion2 = true
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "loop",
      anchor,
      initial,
      condition,
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      body: bodyTemplate,
      maxRounds
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "SMITHERS4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: LoopNode = {
      kind: "loop",
      id,
      initial,
      condition,
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      body: bodyTemplate,
      maxRounds,
      dependencies: expressionDependencies(initial),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: `loopWhile:${descriptor.id}`,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private lowerConditionalExpression(
    expression: ts.ConditionalExpression,
    anchor: string,
    allowFinalAction: boolean
  ): ValueExpr {
    const conditionType = this.checked.checker.getTypeAtLocation(expression.condition)
    const isBoolean = (type: ts.Type): boolean =>
      (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0 ||
      (type.isUnion() && type.types.length > 0 && type.types.every(isBoolean))
    if (!isBoolean(conditionType)) {
      return this.fail(
        expression.condition,
        "SMITHERS4106",
        "durable conditional expressions require a statically boolean condition"
      )
    }

    const condition = this.lowerExpression(expression.condition, `${anchor}:condition`)
    const parentSequencing = this.sequencingDependency
    const whenTrue = this.lowerFragment(expression.whenTrue, `${anchor}:true`, allowFinalAction)
    const whenFalse = this.lowerFragment(expression.whenFalse, `${anchor}:false`, allowFinalAction)
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      kind: "branch",
      anchor,
      condition
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(expression, "SMITHERS4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(expression.questionToken.getStart(this.checked.sourceFile))
    const node: BranchNode = {
      kind: "branch",
      id,
      condition,
      whenTrue,
      whenFalse,
      dependencies: expressionDependencies(condition),
      controlDependencies: parentSequencing === undefined ? [] : [parentSequencing],
      debug: {
        label: "conditional",
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    // Any later source expression must observe the selected arm before it can
    // proceed, including an arm whose value itself has no data dependency.
    this.sequencingDependency = id
    return { kind: "node", nodeId: id, path: [] }
  }

  private lowerFragment(
    expression: ts.Expression,
    anchor: string,
    allowFinalAction: boolean
  ): PlanFragment {
    const parentNodes = this.activeNodes
    const parentSequencing = this.sequencingDependency
    const nodes: PlanNode[] = []
    this.activeNodes = nodes
    this.sequencingDependency = undefined
    try {
      return {
        nodes,
        output: this.lowerExpression(expression, anchor, allowFinalAction)
      }
    } finally {
      this.activeNodes = parentNodes
      this.sequencingDependency = parentSequencing
    }
  }

  /**
   * Refuses with `SMITHERS4124` when `actionSymbol` names a same-file
   * compiler-bound Action whose failure channel holds two Error classes under
   * one durable identity. Returns normally for every other receiver, so each
   * caller keeps its own behaviour for everything else.
   *
   * Shared because THREE lowering forms reach an `X.run(...)` and each had its
   * own generic sentence for "this symbol has no descriptor": the ordinary
   * expression path said "higher-order and dynamic calls are unavailable in
   * durable source lowering", a `fanOut` step said "fanOut body must target one
   * compiler-bound Action", and a `loopWhile` body said "loopWhile body must
   * target one compiler-bound Action". All three are false of a program whose
   * Action IS compiler-bound and whose only defect is a colliding channel — the
   * first sends the author hunting for a higher-order call, the other two for a
   * binding mistake. `sequential` needs no call here: its arguments are lowered
   * through `lowerActionCall`, which already throws past its generic message.
   *
   * `node` is each caller's own existing position, deliberately: this changes
   * what a diagnostic SAYS, never where it points.
   */
  private failIfFailureIdentityCollides(actionSymbol: ts.Symbol | undefined, node: ts.Node): void {
    const collision = actionSymbol && this.checked.collidingActionsBySymbol.get(actionSymbol)
    if (collision !== undefined) {
      this.fail(node, "SMITHERS4124", durableFailureIdentityCollisionMessage(collision))
    }
  }

  private lowerActionCall(
    call: ts.CallExpression,
    anchor: string
  ): { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] } | undefined {
    if (
      !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "run" ||
      call.questionDotToken !== undefined || call.expression.questionDotToken !== undefined
    ) return undefined
    const actionReference = unwrapParentheses(call.expression.expression)
    if (isTypeOnlyReference(this.checked.checker, actionReference)) return undefined
    const actionSymbol = symbolAtExpression(this.checked.checker, actionReference)
    const descriptor = actionSymbol && this.checked.actionsBySymbol.get(actionSymbol)
    if (descriptor === undefined) {
      // Reported here rather than by falling through to `lowerExpression`'s
      // generic tail, because that tail's sentence — "higher-order and dynamic
      // calls are unavailable in durable source lowering" — is false of this
      // program: `X.run({ ... })` is an ordinary compiler-bound Action call.
      //
      // Only the collision is promoted. Every other underivable signature still
      // returns `undefined` and still lands on `SMITHERS4112`, unchanged.
      this.failIfFailureIdentityCollides(actionSymbol, call)
      return undefined
    }
    if (call.arguments.length !== 1 || call.typeArguments !== undefined) {
      return this.fail(call, "SMITHERS4113", `${descriptor.id}.run requires exactly one input argument in durable source`)
    }
    const input = this.lowerExpression(call.arguments[0], `${anchor}:input`)
    const prior = this.usedActions.get(descriptor.id)
    if (prior !== undefined && prior.contractDigest !== descriptor.contractDigest) {
      return this.fail(call, "SMITHERS4114", `Action id ${descriptor.id} resolves to incompatible durable contracts`)
    }
    this.usedActions.set(descriptor.id, descriptor)
    const identity = {
      file: this.logicalFileName,
      flowId: this.flowId,
      flowVersion: this.flowVersion,
      functionName: this.functionName,
      anchor,
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      input
    }
    const occurrenceKey = digest(identity)
    const occurrence = this.occurrences.get(occurrenceKey) ?? 0
    this.occurrences.set(occurrenceKey, occurrence + 1)
    const id = `src-${digest({ ...identity, occurrence }).slice(0, 24)}`
    if (this.nodeIds.has(id)) return this.fail(call, "SMITHERS4199", `stable durable node id collision ${id}`)
    this.nodeIds.add(id)
    const position = this.checked.sourceFile.getLineAndCharacterOfPosition(call.getStart(this.checked.sourceFile))
    const node: ActionNode = {
      kind: "action",
      id,
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      input,
      dependencies: expressionDependencies(input),
      controlDependencies: this.sequencingDependency === undefined ? [] : [this.sequencingDependency],
      debug: {
        label: descriptor.id,
        callSite: `${this.logicalFileName}:${position.line + 1}:${position.character + 1}`
      }
    }
    this.activeNodes.push(node)
    return { kind: "node", nodeId: id, path: [] }
  }

  private propertyName(name: ts.PropertyName): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    return this.fail(name, "SMITHERS4111", "durable object field names must be static")
  }

  private project(value: ValueExpr, key: string, node: ts.Node): ValueExpr {
    if (value.kind === "input" || value.kind === "node") return { ...value, path: [...value.path, key] }
    if (value.kind === "object" && Object.hasOwn(value.fields, key)) return value.fields[key]
    if (value.kind === "array") {
      const index = Number(key)
      if (Number.isSafeInteger(index) && index >= 0 && index < value.items.length) return value.items[index]
    }
    if (value.kind === "literal" && value.value !== null && typeof value.value === "object") {
      if (Array.isArray(value.value)) {
        const index = Number(key)
        if (Number.isSafeInteger(index) && index >= 0 && index < value.value.length) {
          return { kind: "literal", value: value.value[index] }
        }
      } else if (Object.hasOwn(value.value, key)) {
        return { kind: "literal", value: value.value[key] }
      }
    }
    return this.fail(node, "SMITHERS4111", `cannot project ${JSON.stringify(key)} from this durable expression`)
  }
}

export const compileDurableSource = (
  source: string,
  options: DurableSourceCompileOptions
): DurableSourceCompileResult => {
  let logicalFileName = "durable-source.ts"
  let sourceFile: ts.SourceFile | undefined
  try {
    if (typeof source !== "string") throw new TypeError("Durable source must be a string")
    if (options === null || typeof options !== "object") throw new TypeError("Durable source compiler options are required")
    logicalFileName = normalizeLogicalFileName(options.fileName)
    if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
      return {
        ok: false,
        diagnostics: [Object.freeze({
          code: "SMITHERS4101",
          message: "durable source exceeds the compiler input size limit",
          file: logicalFileName,
          line: 1,
          column: 1,
          length: 1
        })]
      }
    }
    const checked = checkedSource(
      source,
      logicalFileName,
      authoredLogicalName(options.fileName),
      options.actions ?? [],
      options.flows ?? []
    )
    sourceFile = checked.sourceFile
    if (checked.sourceDiagnostics.length > 0) {
      const parse = checked.sourceDiagnostics[0]
      const start = parse.start ?? 0
      const position = checked.sourceFile.getLineAndCharacterOfPosition(start)
      return {
        ok: false,
        diagnostics: [Object.freeze({
          code: "SMITHERS4100",
          message: ts.flattenDiagnosticMessageText(parse.messageText, "\n"),
          file: logicalFileName,
          line: position.line + 1,
          column: position.character + 1,
          length: Math.max(1, parse.length ?? 1)
        })]
      }
    }
    const fail = (node: ts.Node, code: string, message: string): never => {
      throw new LoweringFailure(diagnosticAt(logicalFileName, checked.sourceFile, node, code, message))
    }
    const calls = findDurableCalls(checked)
    if (calls.length === 0) fail(checked.sourceFile, "SMITHERS4102", "no imported smithers:flows durable(...) call was found")
    if (calls.length > 1) fail(calls[1], "SMITHERS4102", "bounded durable source compilation accepts exactly one durable(...) declaration")
    const call = calls[0]
    const sourceFunction = resolvedFunction(checked, call, fail)
    const declarationName = declarationNameFor(call, sourceFunction)
    const flowId = options.flowId ?? `${logicalFileName}#${declarationName}`
    const flowVersion = options.flowVersion ?? 1
    if (typeof flowId !== "string" || flowId.trim() === "") fail(call, "SMITHERS4101", "durable Flow id must be non-empty")
    if (!Number.isSafeInteger(flowVersion) || flowVersion < 1) fail(call, "SMITHERS4101", "durable Flow version must be a positive safe integer")
    const lowerer = new FunctionLowerer(
      checked,
      logicalFileName,
      flowId,
      flowVersion,
      sourceFunction.name?.text ?? declarationName,
      fail
    )
    const output = lowerer.lower(sourceFunction)
    const actions = [...lowerer.usedActions.values()]
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    const childFlows = [...lowerer.usedChildFlows.values()]
      .sort((left, right) => left.digest < right.digest ? -1 : left.digest > right.digest ? 1 : 0)
    const childFlowsByDigest = new Map(childFlows.map((child) => [child.digest, child]))
    const schemas = flowSchemas(checked, sourceFunction, output, lowerer.nodes, actions, childFlowsByDigest, fail)
    // The compiler emits the minimal Plan format a program needs so plans in
    // the pre-existing subset keep their exact bytes, digests, and node ids.
    const formatVersion = lowerer.usesFormatVersion3
      ? 3 as const
      : lowerer.usesFormatVersion2
        ? 2 as const
        : 1 as const
    const semantic = {
      formatVersion,
      flowId,
      flowVersion,
      flowSchemas: schemas,
      nodes: lowerer.nodes,
      output,
      requirements: actions.map((action) => action.id),
      actions,
      ...(childFlows.length === 0 ? {} : { childFlows })
    }
    const plan = validatePlanTemplate({ ...semantic, digest: digest(semantic) })
    const artifact = encodePlanArtifact(plan)
    // The second artifact. Derived from `checked` and `sourceFunction` — the
    // Plan lowerer's own INPUTS — never from `plan`, `lowerer.nodes`, or
    // `lowerer.usedActions`. `deriveEffectManifest`'s signature cannot accept
    // any of those three, which is the enforcement.
    let manifest: EffectManifest | undefined
    let manifestFailure: string | undefined
    try {
      manifest = deriveEffectManifest(
        checked,
        {
          logicalFileName,
          flowId,
          flowVersion,
          functionName: sourceFunction.name?.text ?? declarationName
        },
        sourceFunction
      )
    } catch (error) {
      manifestFailure = error instanceof Error ? error.message : String(error)
    }
    return Object.freeze({
      ok: true,
      diagnostics: [] as const,
      plan,
      artifact,
      manifest,
      manifestFailure,
      flow: loadCompiledFlow(artifact),
      // Every derived declaration is reported, not only the ones this Flow
      // used: they all extend the compiler-owned base, which does not survive
      // the erasure of the compiler-owned import.
      derivedActions: checked.derivedActions
    })
  } catch (error) {
    if (error instanceof LoweringFailure) return { ok: false, diagnostics: [error.diagnostic] }
    const fallback = sourceFile ?? ts.createSourceFile(
      logicalFileName,
      typeof source === "string" ? source : "",
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS
    )
    return {
      ok: false,
      diagnostics: [diagnosticAt(
        logicalFileName,
        fallback,
        fallback,
        "SMITHERS4199",
        `durable source compiler failed closed: ${error instanceof Error ? error.message : String(error)}`
      )]
    }
  }
}

export interface EffectManifestCompileSuccess {
  readonly ok: true
  readonly diagnostics: readonly []
  readonly manifest: EffectManifest
}

export type EffectManifestCompileResult = EffectManifestCompileSuccess | DurableSourceCompileFailure

/**
 * Derive a Flow's Effect Manifest **without lowering a Plan**.
 *
 * This is the same front half as {@link compileDurableSource} — the size gate,
 * the checked program, the single compiler-owned `durable(...)` call, and the
 * function it resolves to — followed by `deriveEffectManifest` instead of
 * `FunctionLowerer`. No `PlanNode` is constructed on this path, no
 * `PlanTemplate` is validated, and no artifact is encoded.
 *
 * It exists so the step-5 cross-check can compare a Manifest that provably
 * never saw a Plan against a Plan built by a separate compilation of the same
 * text. `compileDurableSource` also publishes a Manifest, from the same
 * derivation over its own checked program; the cross-check asserts the two are
 * identical, which is what makes "the embedded one is the independent one" a
 * measured claim rather than a design intention.
 */
export const compileEffectManifest = (
  source: string,
  options: DurableSourceCompileOptions
): EffectManifestCompileResult => {
  let logicalFileName = "durable-source.ts"
  let sourceFile: ts.SourceFile | undefined
  try {
    if (typeof source !== "string") throw new TypeError("Durable source must be a string")
    if (options === null || typeof options !== "object") throw new TypeError("Durable source compiler options are required")
    logicalFileName = normalizeLogicalFileName(options.fileName)
    if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
      return {
        ok: false,
        diagnostics: [Object.freeze({
          code: "SMITHERS4101",
          message: "durable source exceeds the compiler input size limit",
          file: logicalFileName,
          line: 1,
          column: 1,
          length: 1
        })]
      }
    }
    const checked = checkedSource(
      source,
      logicalFileName,
      authoredLogicalName(options.fileName),
      options.actions ?? [],
      options.flows ?? []
    )
    sourceFile = checked.sourceFile
    if (checked.sourceDiagnostics.length > 0) {
      const parse = checked.sourceDiagnostics[0]
      const start = parse.start ?? 0
      const position = checked.sourceFile.getLineAndCharacterOfPosition(start)
      return {
        ok: false,
        diagnostics: [Object.freeze({
          code: "SMITHERS4100",
          message: ts.flattenDiagnosticMessageText(parse.messageText, "\n"),
          file: logicalFileName,
          line: position.line + 1,
          column: position.character + 1,
          length: Math.max(1, parse.length ?? 1)
        })]
      }
    }
    const fail = (node: ts.Node, code: string, message: string): never => {
      throw new LoweringFailure(diagnosticAt(logicalFileName, checked.sourceFile, node, code, message))
    }
    const calls = findDurableCalls(checked)
    if (calls.length === 0) fail(checked.sourceFile, "SMITHERS4102", "no imported smithers:flows durable(...) call was found")
    if (calls.length > 1) fail(calls[1], "SMITHERS4102", "bounded durable source compilation accepts exactly one durable(...) declaration")
    const call = calls[0]
    const sourceFunction = resolvedFunction(checked, call, fail)
    const declarationName = declarationNameFor(call, sourceFunction)
    const flowId = options.flowId ?? `${logicalFileName}#${declarationName}`
    const flowVersion = options.flowVersion ?? 1
    if (typeof flowId !== "string" || flowId.trim() === "") fail(call, "SMITHERS4101", "durable Flow id must be non-empty")
    if (!Number.isSafeInteger(flowVersion) || flowVersion < 1) fail(call, "SMITHERS4101", "durable Flow version must be a positive safe integer")
    return Object.freeze({
      ok: true,
      diagnostics: [] as const,
      manifest: deriveEffectManifest(
        checked,
        { logicalFileName, flowId, flowVersion, functionName: sourceFunction.name?.text ?? declarationName },
        sourceFunction
      )
    })
  } catch (error) {
    if (error instanceof LoweringFailure) return { ok: false, diagnostics: [error.diagnostic] }
    const fallback = sourceFile ?? ts.createSourceFile(
      logicalFileName,
      typeof source === "string" ? source : "",
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS
    )
    const node = error instanceof EffectManifestFailure ? error.node : fallback
    return {
      ok: false,
      diagnostics: [diagnosticAt(
        logicalFileName,
        fallback,
        node,
        "SMITHERS4199",
        `durable effect manifest derivation failed closed: ${error instanceof Error ? error.message : String(error)}`
      )]
    }
  }
}

export const DurableSourceCompiler = Object.freeze({ compile: compileDurableSource })

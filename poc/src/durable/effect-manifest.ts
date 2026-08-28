/**
 * The **Effect Manifest** — the static, sets-and-tables artifact a Flow
 * publishes beside its body.
 *
 * `docs/DECISIONS.md` §PR-1 (pending ratification): "the compiler derives and
 * publishes a static Effect Manifest per Flow — reachable Action identities,
 * capability requirement row, external-input contracts, failure row, and site
 * table. Sets and tables only: no control-flow edges, no branch structure, no
 * execution counts."
 *
 * ## What this module may see, and what it may not
 *
 * This module derives the Manifest **from the checked source**, never from the
 * Plan. That is the whole point of the artifact: under the continuation pivot
 * there will be no Plan to read, so a Manifest that could only be projected
 * out of one would validate nothing. Enforced structurally, not by convention:
 *
 * - it imports no Plan *shape* from `plan-ir.ts` — no `PlanTemplate`, no
 *   `PlanNode`, no `PlanFragment`, no `ValueExpr`, no `allPlanNodes`. The two
 *   names it does take from that file, `signalContractIdentity` and
 *   `queueContractIdentity`, are pure hash functions over an authored identity
 *   and a derived schema; they define what an external-input contract *is*,
 *   and they read no Plan (see the note on shared contract derivation below);
 * - {@link deriveEffectManifest} takes an {@link EffectManifestSource}, which
 *   carries a `ts.SourceFile`, a `ts.TypeChecker`, the compiler-owned
 *   intrinsic symbols, and the Action/child-Flow **binding tables** — every
 *   one of which is an *input* the Plan lowerer also reads, not an output it
 *   produces;
 * - the traversal is its own. It is a plain syntactic descent
 *   (`ts.forEachChild`) over the durable function, with no value environment,
 *   no dependency edges, no node ids, and no ordering. It does not consult
 *   `FunctionLowerer`, its `usedActions` map, its node list, or its result.
 *
 * ## Why a syntactic descent is the right shape
 *
 * PR-1's discipline is that the Manifest "MUST be sound with respect to
 * reachability and imprecise about everything else. The moment it acquires an
 * edge, a branch, or a count, it has started growing back into a plan."
 *
 * A descent that visits every child node gets soundness for free and cannot
 * express anything else: both arms of a conditional, the body of a fan-out
 * callback, and the body of a loop template are all just children, so their
 * effects are all in the Manifest, and the Manifest has no way to say *which*
 * arm, *how many* rounds, or *in what order*. An analysis that tried to be
 * precise here would have to model control flow, which is the thing being
 * deleted.
 *
 * The one thing shared with the Plan lowerer on purpose is **contract
 * derivation** — `deriveDurableValueSchema`, `signalContractIdentity`,
 * `queueContractIdentity`, and the `ActionDescriptor`s in the binding table.
 * Those *define* the contract identities. Two independent copies of them would
 * not test reachability; they would test whether two transcriptions of the
 * same hash agree, and would let a real divergence hide behind a spurious one.
 */
import * as ts from "typescript-js"
import { deriveDurableValueSchema } from "./schema.ts"
import { effectSiteId, type EffectSiteIdentity } from "./site-id.ts"
import {
  type ActionDescriptor,
  digest,
  type DurableSchema,
  type DurableTypeDescriptor,
  type StructuralDurableSchema
} from "./value.ts"

/**
 * Canonical signal/queue contract identity, shared with the Plan lowerer.
 * These two hash an authored identity plus a derived schema and nothing else;
 * they are the definition of a contract identity, not a view of a Plan.
 */
import { queueContractIdentity, signalContractIdentity } from "./plan-ir.ts"

/**
 * A previously compiled child Flow, reduced to the three fields a Manifest
 * needs. Deliberately NOT `PlanTemplate`: a child Flow arrives as a caller
 * *binding*, and narrowing it here keeps this module unable to see a Plan even
 * when one is handed to it.
 */
export interface EffectManifestChildFlow {
  readonly flowId: string
  readonly flowVersion: number
  readonly digest: string
}

/**
 * Everything the derivation reads. Every field is an input the Plan lowerer
 * reads too; none is something the Plan lowerer produces.
 */
export interface EffectManifestSource {
  readonly sourceFile: ts.SourceFile
  readonly checker: ts.TypeChecker
  readonly sleepSymbol: ts.Symbol
  readonly signalSymbol: ts.Symbol
  readonly broadcastSymbol: ts.Symbol
  readonly queueSymbol: ts.Symbol
  readonly actionsBySymbol: ReadonlyMap<ts.Symbol, ActionDescriptor>
  readonly flowsBySymbol: ReadonlyMap<ts.Symbol, EffectManifestChildFlow>
  /**
   * The Manifest each bound child Flow published.
   *
   * A parent's effect set is transitive — the Plan lowerer copies a child's
   * whole Action set into the parent's requirement row — so the parent Manifest
   * has to be transitive too. It composes the child's **Manifest**, never the
   * child's Plan; that is the composition the pivot leaves standing.
   */
  readonly childManifestsBySymbol: ReadonlyMap<ts.Symbol, EffectManifest>
  /** The compiler-owned `Action` base class; see the fail-closed rule below. */
  readonly actionBaseSymbol: ts.Symbol
}

/** One reachable Action identity. */
export interface EffectManifestAction {
  readonly id: string
  readonly version: number
  readonly contractDigest: string
}

/**
 * One external-input contract: a value that enters the Flow from outside it
 * and therefore has to be addressable, schema-validated, and authorizable
 * before the execution reaches the wait.
 */
export interface EffectManifestContract {
  readonly kind: "signal" | "broadcast" | "queue" | "childFlow"
  readonly identity: string
  readonly contractDigest: string
}

/**
 * One request-issuing source position.
 *
 * A table, not a graph: each row names a site and what kind of request it
 * issues. There is no successor, no predecessor, and no count — two sites in
 * the two arms of one conditional are two independent rows with nothing
 * relating them, which is exactly the imprecision PR-1 requires.
 */
export interface EffectManifestSite {
  readonly id: string
  readonly kind: "perform" | "sleep" | "signal" | "broadcast" | "queue" | "childFlow"
  readonly anchor: string
  readonly key?: string
}

export interface EffectManifest {
  readonly manifestVersion: 1
  readonly flowId: string
  readonly flowVersion: number
  /** Reachable Action identities, sorted by id. */
  readonly actions: readonly EffectManifestAction[]
  /** The capability requirement row, sorted. */
  readonly requirements: readonly string[]
  /** External-input contracts, sorted by kind then identity. */
  readonly contracts: readonly EffectManifestContract[]
  /** Durable failure identities reachable through the Actions above, sorted. */
  readonly failures: readonly string[]
  /** The site table, sorted by id. */
  readonly sites: readonly EffectManifestSite[]
  readonly digest: string
}

/** A Manifest derivation that could not complete, with its authored position. */
export class EffectManifestFailure extends Error {
  constructor(message: string, readonly node: ts.Node) {
    super(message)
    this.name = "EffectManifestFailure"
  }
}

const canonicalSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined =>
  symbol === undefined ? undefined : symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol

const referencedSymbol = (checker: ts.TypeChecker, expression: ts.Expression): ts.Symbol | undefined => {
  const target = ts.isPropertyAccessExpression(expression) ? expression.name : expression
  return canonicalSymbol(checker, checker.getSymbolAtLocation(target))
}

/**
 * A reference that exists only in the type world. It denotes no runtime value,
 * so it issues no request and must not put an Action or a contract in the
 * Manifest. Written against the TypeScript API here rather than imported: this
 * is generic symbol mechanics, and a second reading of it is a fact the
 * cross-check can compare, whereas a shared call is not.
 */
const isTypeOnlyReference = (checker: ts.TypeChecker, expression: ts.Expression): boolean => {
  if (ts.isPropertyAccessExpression(expression) && isTypeOnlyReference(checker, expression.expression)) return true
  const target = ts.isPropertyAccessExpression(expression) ? expression.name : expression
  const symbol = checker.getSymbolAtLocation(target)
  if (symbol === undefined || !(symbol.flags & ts.SymbolFlags.Alias)) return false
  return (symbol.declarations ?? []).some((declaration) => {
    if (ts.isImportSpecifier(declaration)) return declaration.isTypeOnly || declaration.parent.parent.isTypeOnly
    if (ts.isNamespaceImport(declaration)) return declaration.parent.isTypeOnly
    if (ts.isImportClause(declaration)) return declaration.isTypeOnly
    return false
  })
}

const skipParentheses = (expression: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(expression) ? skipParentheses(expression.expression) : expression

/** Every durable failure identity a schema's descriptor can carry. */
const failureIdentities = (schema: DurableSchema, into: Set<string>): void => {
  if (schema.shape !== "structural") return
  const pending: DurableTypeDescriptor[] = [(schema as StructuralDurableSchema).descriptor]
  while (pending.length > 0) {
    const descriptor = pending.pop()!
    switch (descriptor.kind) {
      case "error":
        into.add(descriptor.identity)
        pending.push(descriptor.payload)
        break
      case "union":
        pending.push(...descriptor.variants)
        break
      case "array":
        pending.push(descriptor.element)
        break
      case "tuple":
        pending.push(...descriptor.items)
        break
      case "object":
        pending.push(...descriptor.fields.map((field) => field.value))
        break
      default:
        break
    }
  }
}

const sortedStrings = (values: Iterable<string>): readonly string[] => [...new Set(values)].sort()

/**
 * Derive the Effect Manifest of one durable function.
 *
 * `body` is the authored function the `durable(...)` call resolved to. Nothing
 * else about the call is read, and nothing about the Plan is read at all.
 */
export const deriveEffectManifest = (
  source: EffectManifestSource,
  options: {
    /**
     * The **authored** source name (`orders.sm`), never the compiled unit's
     * (`orders.sm.ts`). A site identity names a position in the program the
     * author wrote; anchoring it on the virtual TypeScript file this compiler
     * mints to run a checker made every site id — and therefore, under PR-2,
     * every journal key — differ between the two backends for the same text.
     */
    readonly authoredFileName: string
    readonly flowId: string
    readonly flowVersion: number
    readonly functionName: string
  },
  body: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration
): EffectManifest => {
  const { checker, sourceFile } = source
  const actions = new Map<string, EffectManifestAction>()
  const requirements = new Set<string>()
  const contracts = new Map<string, EffectManifestContract>()
  const failures = new Set<string>()
  const sites: EffectManifestSite[] = []
  const occurrences = new Map<string, number>()

  const anchorOf = (node: ts.Node): string => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    return `${line}:${character}`
  }

  const recordSite = (node: ts.Node, kind: EffectManifestSite["kind"], key?: string): void => {
    const anchor = anchorOf(node)
    const identity: EffectSiteIdentity = key === undefined
      ? { file: options.authoredFileName, functionName: options.functionName, kind: "perform", anchor }
      : { file: options.authoredFileName, functionName: options.functionName, kind: "perform", anchor, key }
    // The site table is keyed by the shared content-addressed scheme
    // (`site-id.ts`), with an occurrence counter that exists ONLY to keep two
    // syntactically distinct sites that hash alike from colliding. It is not
    // an execution count and never reaches a set the cross-check compares.
    const bucket = digest({ ...identity, requestKind: kind })
    const occurrence = occurrences.get(bucket) ?? 0
    occurrences.set(bucket, occurrence + 1)
    sites.push({
      id: effectSiteId({ ...identity, kind: "perform" }, occurrence),
      kind,
      anchor,
      ...(key === undefined ? {} : { key })
    })
  }

  const literalIdentity = (call: ts.CallExpression, what: string): string => {
    const argument = call.arguments.length === 1 ? skipParentheses(call.arguments[0]) : undefined
    if (
      argument === undefined ||
      (!ts.isStringLiteral(argument) && !ts.isNoSubstitutionTemplateLiteral(argument))
    ) {
      throw new EffectManifestFailure(`durable ${what} identity must be one static string literal`, call)
    }
    return argument.text
  }

  const payloadSchema = (call: ts.CallExpression, what: string): StructuralDurableSchema => {
    const typeNode = call.typeArguments?.length === 1 ? call.typeArguments[0] : undefined
    if (typeNode === undefined) {
      throw new EffectManifestFailure(`durable ${what} requires one explicit payload type argument`, call)
    }
    return deriveDurableValueSchema(
      checker,
      sourceFile,
      typeNode,
      checker.getTypeFromTypeNode(typeNode),
      "input",
      `${what} payload`
    )
  }

  /** Whether a symbol is declared as `class X extends Action<...>`. */
  const extendsActionBase = (symbol: ts.Symbol): boolean =>
    (symbol.declarations ?? []).some((declaration) =>
      ts.isClassDeclaration(declaration) &&
      (declaration.heritageClauses ?? [])
        .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        .flatMap((clause) => [...clause.types])
        .some((base) => canonicalSymbol(checker, checker.getSymbolAtLocation(base.expression)) === source.actionBaseSymbol)
    )

  const addContract = (contract: EffectManifestContract): void => {
    contracts.set(`${contract.kind}#${contract.identity}#${contract.contractDigest}`, contract)
  }

  const classify = (call: ts.CallExpression): void => {
    const callee = skipParentheses(call.expression)
    if (isTypeOnlyReference(checker, callee)) return
    // `X.run(input)` — an Action perform, or a child-Flow boundary.
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "run") {
      const receiver = skipParentheses(callee.expression)
      if (isTypeOnlyReference(checker, receiver)) return
      const symbol = referencedSymbol(checker, receiver)
      if (symbol === undefined) return
      const descriptor = source.actionsBySymbol.get(symbol)
      if (descriptor !== undefined) {
        actions.set(descriptor.id, {
          id: descriptor.id,
          version: descriptor.version,
          contractDigest: descriptor.contractDigest
        })
        requirements.add(descriptor.id)
        failureIdentities(descriptor.errorSchema, failures)
        recordSite(call, "perform", descriptor.id)
        return
      }
      const child = source.flowsBySymbol.get(symbol)
      if (child !== undefined) {
        addContract({ kind: "childFlow", identity: child.flowId, contractDigest: child.digest })
        recordSite(call, "childFlow", child.flowId)
        // MEASURED, not assumed: without this the step-5 cross-check reported
        // the parent Plan's action set as `{Publish, Transform}` and the parent
        // Manifest's as `{Publish}`. `Transform` is performed by the child, and
        // `provider.ts`'s deployment-closure check reads the requirement row,
        // so a non-transitive Manifest would lose a provider and fail
        // mid-execution — the exact failure `durable-execution.mdx:121` says
        // must never be auto-retried.
        const childManifest = source.childManifestsBySymbol.get(symbol)
        if (childManifest === undefined) {
          throw new EffectManifestFailure(
            `child Flow ${child.flowId} was bound without its Effect Manifest, so this Flow's transitive` +
              ` effect set cannot be stated soundly`,
            call
          )
        }
        for (const action of childManifest.actions) {
          actions.set(action.id, action)
          requirements.add(action.id)
        }
        for (const requirement of childManifest.requirements) requirements.add(requirement)
        for (const contract of childManifest.contracts) addContract(contract)
        for (const failure of childManifest.failures) failures.add(failure)
        return
      }
      // FAIL CLOSED. The receiver is an `Action` subclass whose durable
      // contract the compiler could not derive — an identity collision in its
      // failure channel, or a signature outside the derivable subset. There is
      // no descriptor to put in the Manifest, and dropping the site would
      // publish "this Flow reaches no such Action" about a Flow that performs
      // it.
      //
      // MEASURED, not hypothesised: this is what
      // `17-durable/two-error-classes-whose-durable-identities-collide-are-rejected`
      // did before this branch existed. The Plan refused it with SMITHERS4124
      // and the Manifest answered `actions: []`, which is exactly the silent
      // narrowing PR-1 forbids. The step-5 cross-check is what found it.
      if (extendsActionBase(symbol)) {
        throw new EffectManifestFailure(
          `durable Action ${symbol.name} has no derivable durable contract, so its effect cannot be` +
            ` stated soundly in the Effect Manifest`,
          call
        )
      }
      return
    }
    const symbol = referencedSymbol(checker, callee)
    if (symbol === undefined) return
    if (symbol === source.sleepSymbol) {
      recordSite(call, "sleep")
      return
    }
    if (symbol === source.signalSymbol) {
      const identity = literalIdentity(call, "signal")
      addContract({
        kind: "signal",
        identity,
        contractDigest: signalContractIdentity(identity, payloadSchema(call, "signal"))
      })
      recordSite(call, "signal", identity)
      return
    }
    if (symbol === source.broadcastSymbol) {
      const identity = literalIdentity(call, "broadcast signal")
      addContract({
        kind: "broadcast",
        identity,
        contractDigest: signalContractIdentity(identity, payloadSchema(call, "broadcast signal"), "broadcast")
      })
      recordSite(call, "broadcast", identity)
      return
    }
    if (symbol === source.queueSymbol) {
      const identity = literalIdentity(call, "queue")
      addContract({
        kind: "queue",
        identity,
        contractDigest: queueContractIdentity(identity, payloadSchema(call, "queue"))
      })
      recordSite(call, "queue", identity)
    }
  }

  // The whole analysis. Every call expression anywhere beneath the durable
  // function is classified, including both arms of a conditional and the body
  // of every inline callback, because a child is a child. Nothing here knows
  // what a branch is.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) classify(node)
    ts.forEachChild(node, visit)
  }
  if (body.body !== undefined) visit(body.body)

  const manifest = {
    manifestVersion: 1 as const,
    flowId: options.flowId,
    flowVersion: options.flowVersion,
    actions: [...actions.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    requirements: sortedStrings(requirements),
    contracts: [...contracts.values()].sort((left, right) => {
      const a = `${left.kind}#${left.identity}#${left.contractDigest}`
      const b = `${right.kind}#${right.identity}#${right.contractDigest}`
      return a < b ? -1 : a > b ? 1 : 0
    }),
    failures: sortedStrings(failures),
    sites: [...sites].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  }
  return Object.freeze({ ...manifest, digest: digest(manifest) })
}

/**
 * The four sets the step-5 cross-check compares, projected out of a Manifest.
 *
 * Kept here so the comparison has exactly one spelling on the Manifest side;
 * the Plan side is projected by the test, from the Plan.
 *
 * `failures` was the fourth and it was added late. The action, capability and
 * contract sets were cross-checked against the Plan from the start; the failure
 * row was derived by `failureIdentities` above and compared against nothing at
 * all — in either backend — even though it is the one Manifest row whose
 * contents are a file name plus a class name, and therefore the row most
 * exposed to a non-portable logical name. A row nothing disagrees with is not
 * evidence.
 */
export const effectManifestSets = (manifest: EffectManifest): {
  readonly actions: readonly string[]
  readonly capabilities: readonly string[]
  readonly contracts: readonly string[]
  readonly failures: readonly string[]
} => ({
  failures: [...manifest.failures].sort(),
  actions: manifest.actions
    .map((action) => `${action.id}@${action.version}#${action.contractDigest}`)
    .slice()
    .sort(),
  capabilities: [...manifest.requirements].sort(),
  contracts: manifest.contracts
    .map((contract) => `${contract.kind}:${contract.identity}#${contract.contractDigest}`)
    .slice()
    .sort()
})

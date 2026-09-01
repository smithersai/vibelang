/**
 * ## Why this file is still a Plan-node diff, and what has to happen first
 *
 * `MIGRATION-PLAN.md` step 12 calls for rewriting this module as "~110 lines of
 * site-table diff" — {@link assertNodeMigrationCompatible} replaced by a diff
 * over two `EffectManifest` site tables. That rewrite is BLOCKED, and the
 * blocker was measured rather than argued:
 *
 * ```
 * plan node ids  [ "action:src-b2a564543ce6ea043c28dabf" ]
 * manifest sites [ "perform:src-efd2893dcaa39acdb7611bf7" ]
 * ```
 *
 * — one Flow, one `Action.run` call, compiled through `compileDurableSource`
 * and `compileEffectManifest`. A Plan node id and the Manifest site id for the
 * SAME call site are different strings. `MIGRATION-PLAN.md` §4 records the two
 * schemes as already agreeing ("Both backends already agree on this scheme");
 * the two BACKENDS agree, but the Plan lowerer and the Manifest derivation do
 * not agree with each other.
 *
 * That matters because every judgment below is a lookup keyed by node id
 * against `durable_nodes.node_id`, and a Plan-engine execution's rows carry
 * PLAN node ids. A site-table diff would compare a disjoint key space: `frozen`
 * would be empty for every execution, `decidedBranchIds` would be empty, and
 * every "this node already committed, its semantics may not move" refusal would
 * silently become a no-op. A migration that reinterpreted a committed Action
 * would be ACCEPTED. That is a fail-open, and it is invisible to every existing
 * test because the tests construct their evidence from the same Plan the diff
 * reads.
 *
 * So the order is: retire the Plan engine, so `durable_nodes` has exactly one
 * key space (the site id the replay driver already journals — see
 * `vertical-slice.test.ts`), and only then replace this diff. Doing it in the
 * other order is the defect, not the cleanup.
 *
 * `migration.test.ts` is NOT deletable on the same reasoning. Audited block by
 * block: of its 14 `test` blocks, 5 are expressed in Plan node shape (Flow
 * schema freeze, branch-decision freeze, fan-out materialization evidence,
 * timer deadline evidence, and the branch skip/fence race) and 9 are not —
 * deployment fencing, stale-coordinator abandon-instead-of-terminalize, crash
 * idempotency after COMMIT, the two-connection migration race, unknown/terminal
 * execution, forged-artifact re-derivation, and the attached-child abandon
 * rule. Those 9 guard the pinning substrate `MIGRATION-PLAN.md` §4 says
 * SURVIVES the pivot, and a site-table diff does not re-express any of them.
 */
import { validateDeploymentManifest, validatePlanTemplate } from "./artifact.ts"
import {
  allPlanNodes,
  canonicalJson,
  type DeploymentManifest,
  digest,
  fragmentNodeIds,
  type PlanNode,
  type PlanTemplate
} from "./ir.ts"

/**
 * Every way a migration can be refused. The reason is part of the error value
 * so a caller can assert the exact judgment instead of matching prose.
 */
export type MigrationRejectionReason =
  /** The execution id is not known to this store. */
  | "unknown-execution"
  /** The execution already has a durable terminal outcome. */
  | "terminal-execution"
  /** The execution is not pinned to the migration's `from` Plan/manifest. */
  | "pinned-digest-mismatch"
  /** `from` and `to` name the same Plan and manifest; there is nothing to apply. */
  | "no-op-migration"
  /** The two Plans are different Flows. */
  | "flow-identity-changed"
  /** The Flow input, success, or error contract is not byte-identical. */
  | "flow-contract-changed"
  /** A Plan node id exists in exactly one of the two Plans. */
  | "node-set-changed"
  /** A Plan node id changed its node kind. */
  | "node-kind-changed"
  /** A node with committed durable evidence changed its semantics. */
  | "committed-node-semantics-changed"
  /** A pinned signal or queue contract digest changed. */
  | "pinned-contract-changed"
  /** The persisted Flow input no longer satisfies the target input schema. */
  | "pinned-input-rejected"

export class MigrationRejectedError extends Error {
  constructor(
    readonly reason: MigrationRejectionReason,
    message: string
  ) {
    super(message)
    this.name = "MigrationRejectedError"
  }
}

/**
 * The identity of exactly one deployment: the Plan a coordinator would replay
 * and the manifest it would replay it under. This — not the Plan digest alone —
 * is what an execution is pinned to, and what every fence compares.
 *
 * BOTH halves are load-bearing. A manifest-only migration (a hotfixed
 * implementation, a re-routed pool, a changed policy or capability grant)
 * leaves `planDigest` byte-identical while replacing everything the coordinator
 * would actually run. It is also not an exotic case: a compiled Plan's node ids
 * are content-addressed over each call site's Action identity, so ANY Plan
 * change renames nodes and `assertNodeMigrationCompatible` refuses it as
 * `node-set-changed`. For every Flow that reaches the compiler — which is every
 * Flow with an attached child — manifest-only is the only migration shape that
 * exists.
 *
 * The alternative of fencing on `plan_generation` was rejected: the counter
 * orders migrations OF ONE EXECUTION and says nothing about which deployment a
 * coordinator holds, so it cannot detect the generation-0 case this fence has
 * always also been responsible for — a coordinator addressing an execution
 * pinned to a deployment it does not hold and that was never migrated at all.
 */
export interface PinnedDeployment {
  readonly planDigest: string
  readonly manifestDigest: string
}

const SHA256_DIGEST = /^[0-9a-f]{64}$/

/** Fails closed on a structurally invalid pinned identity from any caller. */
export const assertPinnedDeploymentShape = (
  value: PinnedDeployment,
  label: string
): PinnedDeployment => {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    typeof value.planDigest !== "string" || !SHA256_DIGEST.test(value.planDigest) ||
    typeof value.manifestDigest !== "string" || !SHA256_DIGEST.test(value.manifestDigest)
  ) {
    throw new TypeError(`Durable ${label} must pin a Plan digest and a deployment manifest digest`)
  }
  return value
}

/**
 * Raised when a coordinator addresses an execution that is not pinned to that
 * coordinator's DEPLOYMENT — a different Plan, a different manifest, or both.
 * It is deliberately NOT a durable failure: a stale coordinator must abandon
 * the execution the way a dead process does, never terminalize it.
 */
export class ExecutionMigratedError extends Error {
  readonly expectedPlanDigest: string
  readonly pinnedPlanDigest: string
  readonly expectedManifestDigest: string
  readonly pinnedManifestDigest: string
  constructor(
    readonly executionId: string,
    expected: PinnedDeployment,
    pinned: PinnedDeployment,
    readonly generation: number
  ) {
    const identity = `Plan ${pinned.planDigest} / manifest ${pinned.manifestDigest}`
    const held = `Plan ${expected.planDigest} / manifest ${expected.manifestDigest}`
    super(
      generation > 0
        ? `Execution ${executionId} was migrated to ${identity}; coordinator ${held} is stale`
        : `Execution ${executionId} is pinned to ${identity}, not coordinator ${held}`
    )
    this.name = "ExecutionMigratedError"
    this.expectedPlanDigest = expected.planDigest
    this.pinnedPlanDigest = pinned.planDigest
    this.expectedManifestDigest = expected.manifestDigest
    this.pinnedManifestDigest = pinned.manifestDigest
  }
}

/**
 * An explicit, opt-in description of one in-flight execution's move from one
 * pinned deployment to another. It carries both complete artifacts rather than
 * only digests, because every compatibility rule below is re-derived from the
 * artifacts inside the applying transaction — the judgment is verified, never
 * trusted from the caller.
 */
export interface MigrationPlan {
  readonly formatVersion: 1
  readonly flowId: string
  readonly from: { readonly plan: PlanTemplate; readonly manifest: DeploymentManifest }
  readonly to: { readonly plan: PlanTemplate; readonly manifest: DeploymentManifest }
  readonly fromPlanDigest: string
  readonly fromManifestDigest: string
  readonly toPlanDigest: string
  readonly toManifestDigest: string
  /** Canonical identity of exactly this migration, journaled when it applies. */
  readonly digest: string
}

/** Durable evidence about one execution, read inside the applying transaction. */
export interface ExecutionMigrationEvidence {
  /**
   * Static node ids that already hold a durable terminal exit.
   *
   * A committed BRANCH DECISION is visible here too, and only here: `skipNodes`
   * terminalizes every node of the untaken fragment while the branch's own row
   * is still `pending`/`running`, so the branch appears in none of the three
   * sets below. `assertNodeMigrationCompatible` therefore derives the decided
   * branches from this list rather than taking a fifth query on trust.
   */
  readonly committedNodeIds: readonly string[]
  /**
   * Fan-out and loop template node ids that already committed a materialization.
   *
   * A fan-out's evidence is its committed `fanout_digest`, NOT the presence of
   * child rows: a fan-out over an empty collection commits the digest with zero
   * children, and that node's entry set is just as frozen as a fan-out with a
   * thousand of them.
   */
  readonly materializedTemplateIds: readonly string[]
  /** childFlow node ids already linked to a durable child execution. */
  readonly linkedChildFlowIds: readonly string[]
  /**
   * timer node ids whose absolute wake deadline is already committed. The
   * deadline was derived from the old `durationMs` and is never recomputed, so
   * a migration that changes it would be silently discarded rather than
   * applied.
   */
  readonly scheduledTimerIds: readonly string[]
}

const TERMINAL_NODE_STATES = new Set(["succeeded", "failed", "defect", "skipped", "cancelled"])

export const isCommittedNodeStatus = (status: string): boolean => TERMINAL_NODE_STATES.has(status)

/**
 * Node semantics that must not move under a committed node. `debug` is
 * deliberately excluded: the label and call site carry no execution semantics
 * and shift whenever unrelated lines above the node move, so including them
 * would make migration unusable for exactly the edits it exists to permit.
 */
const nodeSemantics = (node: PlanNode): string => {
  const { debug: _debug, ...semantic } = node as PlanNode & { readonly debug?: unknown }
  return canonicalJson(semantic)
}

/**
 * The part of a branch node its already-committed decision depends on.
 *
 * A branch commits durable, terminal, inverse-less evidence — `skipped` on every
 * node of the arm it did not take — while its OWN row is still `pending` or
 * `running`, and it stays that way for the entire lifetime of the arm it did
 * take. That evidence is in `committedNodeIds` (each skipped node is terminal),
 * but the branch that produced it is in none of the evidence sets, so without
 * this its `condition` would still be free to move. A migration that flipped it
 * would send the resumed execution into an arm whose nodes are already
 * `skipped`, and reading a skipped node is a `SkippedValueDefect` the execution
 * cannot be resumed out of.
 *
 * Exactly two things decide which nodes were skipped, so exactly two things are
 * frozen: the `condition` bytes, and which node ids each arm owns (recursively,
 * because `skipNodes` skips the whole untaken fragment, and as a SET, because
 * reordering an arm skips the same nodes). Everything else inside the fragments
 * is deliberately left alone — a node in either arm that already ran is frozen
 * by its own committed status, and one that has not is exactly the kind of edit
 * migration exists to permit. `validateScope` makes that safe: an arm's nodes
 * are lexically visible only inside that arm, so no expression anywhere else in
 * the Plan can be edited into reading a skipped value.
 */
const branchDecision = (node: PlanNode): string | undefined =>
  node.kind === "branch"
    ? canonicalJson({
      condition: node.condition,
      whenTrue: [...fragmentNodeIds(node.whenTrue)].sort(),
      whenFalse: [...fragmentNodeIds(node.whenFalse)].sort()
    })
    : undefined

const contractIdentity = (node: PlanNode): string | undefined =>
  node.kind === "signal"
    ? canonicalJson({ signalId: node.signalId, contract: node.signalContractDigest })
    : node.kind === "queue"
      ? canonicalJson({ queueId: node.queueId, contract: node.queueContractDigest })
      : undefined

const reject = (reason: MigrationRejectionReason, message: string): never => {
  throw new MigrationRejectedError(reason, message)
}

/**
 * Builds a validated migration description. Both artifacts are revalidated
 * here, and the Flow-level rules that do not need execution evidence are
 * decided up front so an obviously incompatible migration is refused before it
 * is ever offered to a store.
 */
export const planExecutionMigration = (
  from: { readonly plan: PlanTemplate; readonly manifest: DeploymentManifest },
  to: { readonly plan: PlanTemplate; readonly manifest: DeploymentManifest }
): MigrationPlan => {
  const fromPlan = validatePlanTemplate(from?.plan)
  const fromManifest = validateDeploymentManifest(from?.manifest, fromPlan)
  const toPlan = validatePlanTemplate(to?.plan)
  const toManifest = validateDeploymentManifest(to?.manifest, toPlan)
  if (fromPlan.digest === toPlan.digest && fromManifest.digest === toManifest.digest) {
    reject("no-op-migration", "Migration must change the pinned Plan or deployment manifest")
  }
  assertFlowContractPreserved(fromPlan, toPlan)
  const semantic = {
    formatVersion: 1 as const,
    flowId: fromPlan.flowId,
    fromPlanDigest: fromPlan.digest,
    fromManifestDigest: fromManifest.digest,
    toPlanDigest: toPlan.digest,
    toManifestDigest: toManifest.digest
  }
  return Object.freeze({
    ...semantic,
    from: Object.freeze({ plan: fromPlan, manifest: fromManifest }),
    to: Object.freeze({ plan: toPlan, manifest: toManifest }),
    digest: digest(semantic)
  })
}

/** Flow-level rules: identity and the complete persistence contract are frozen. */
export const assertFlowContractPreserved = (fromPlan: PlanTemplate, toPlan: PlanTemplate): void => {
  if (fromPlan.flowId !== toPlan.flowId) {
    reject(
      "flow-identity-changed",
      `Migration cannot move execution history from Flow ${fromPlan.flowId} to ${toPlan.flowId}`
    )
  }
  const fromSchemas = fromPlan.flowSchemas
  const toSchemas = toPlan.flowSchemas
  if ((fromSchemas === undefined) !== (toSchemas === undefined)) {
    reject("flow-contract-changed", "Migration cannot add or remove the compiler-derived Flow schemas")
  }
  if (fromSchemas !== undefined && toSchemas !== undefined) {
    for (const role of ["input", "success", "error"] as const) {
      const before = fromSchemas[role]
      const after = toSchemas[role]
      if ((before === undefined) !== (after === undefined)) {
        reject("flow-contract-changed", `Migration cannot add or remove the Flow ${role} schema`)
      }
      if (before !== undefined && after !== undefined && canonicalJson(before) !== canonicalJson(after)) {
        reject("flow-contract-changed", `Migration cannot change the Flow ${role} contract`)
      }
    }
  }
}

/**
 * The complete node-level judgment, decided from the two validated Plans and
 * the execution's own durable node rows.
 *
 * Enforced:
 * - the static node id set is identical, so no durable node row is orphaned and
 *   no new node id appears without a row;
 * - every node keeps its kind;
 * - every node with a durable terminal exit keeps byte-identical semantics
 *   (excluding `debug`), so a committed exit can never be reinterpreted;
 * - a template that already committed a materialization (a fan-out digest —
 *   including the empty one, which commits zero item rows — loop rounds) or
 *   linked a child execution is frozen too, even while that template node is
 *   itself still running, because those durable identities were derived from
 *   it;
 * - a timer whose absolute wake deadline is already committed is frozen for
 *   exactly the same reason: the deadline was derived from the old duration and
 *   is never recomputed, so an accepted change would be silently discarded;
 * - a branch that already committed its arm decision keeps that decision — its
 *   `condition` bytes and each arm's node-id membership — because `skipped` is
 *   terminal and has no inverse, so a decision the new Plan disagrees with
 *   strands the execution on a `SkippedValueDefect` (see `branchDecision`); and
 * - every signal and queue contract digest is frozen, committed or not, because
 *   the store pins those contracts once at initialization and this migration
 *   deliberately does not re-pin them.
 */
export const assertNodeMigrationCompatible = (
  fromPlan: PlanTemplate,
  toPlan: PlanTemplate,
  evidence: ExecutionMigrationEvidence
): void => {
  const before = new Map(allPlanNodes(fromPlan).map((node) => [node.id, node]))
  const after = new Map(allPlanNodes(toPlan).map((node) => [node.id, node]))
  for (const id of before.keys()) {
    if (!after.has(id)) {
      reject("node-set-changed", `Migration would orphan durable node ${id}, which the target Plan does not declare`)
    }
  }
  for (const id of after.keys()) {
    if (!before.has(id)) {
      reject("node-set-changed", `Migration introduces node ${id}, which this execution has no durable row for`)
    }
  }
  const frozen = new Set<string>([
    ...evidence.committedNodeIds,
    ...evidence.materializedTemplateIds,
    ...evidence.linkedChildFlowIds,
    ...evidence.scheduledTimerIds
  ])
  // A branch whose arm decision is already committed is derived here rather than
  // queried, because the evidence is already in `committedNodeIds`: `skipNodes`
  // terminalizes the untaken fragment the instant the branch is claimed, and by
  // the time any node of the taken arm is terminal the decision is just as
  // committed. Deriving it keeps every direct caller of this function — not only
  // `migrateExecution` — covered without a new evidence member to forget to fill.
  const committed = new Set(evidence.committedNodeIds)
  const decidedBranchIds = new Set<string>()
  for (const [id, node] of before) {
    if (node.kind !== "branch") continue
    const arms = [...fragmentNodeIds(node.whenTrue), ...fragmentNodeIds(node.whenFalse)]
    if (arms.some((armNodeId) => committed.has(armNodeId))) decidedBranchIds.add(id)
  }
  for (const [id, beforeNode] of before) {
    const afterNode = after.get(id)!
    if (beforeNode.kind !== afterNode.kind) {
      reject(
        "node-kind-changed",
        `Migration changes node ${id} from ${beforeNode.kind} to ${afterNode.kind}`
      )
    }
    if (decidedBranchIds.has(id) && branchDecision(beforeNode) !== branchDecision(afterNode)) {
      reject(
        "committed-node-semantics-changed",
        `Migration changes the arm decision of branch ${id}, which has already committed a skip`
      )
    }
    const beforeContract = contractIdentity(beforeNode)
    if (beforeContract !== undefined && beforeContract !== contractIdentity(afterNode)) {
      reject(
        "pinned-contract-changed",
        `Migration changes the pinned ${beforeNode.kind} contract on node ${id}`
      )
    }
    if (frozen.has(id) && nodeSemantics(beforeNode) !== nodeSemantics(afterNode)) {
      reject(
        "committed-node-semantics-changed",
        `Migration changes the semantics of node ${id}, which already has committed durable evidence`
      )
    }
  }
}

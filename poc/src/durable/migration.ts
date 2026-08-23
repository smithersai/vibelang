import { validateDeploymentManifest, validatePlanTemplate } from "./artifact.ts"
import {
  allPlanNodes,
  canonicalJson,
  type DeploymentManifest,
  digest,
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
 * Raised when a coordinator addresses an execution that is not pinned to that
 * coordinator's Plan. It is deliberately NOT a durable failure: a stale
 * coordinator must abandon the execution, never terminalize it.
 */
export class ExecutionMigratedError extends Error {
  constructor(
    readonly executionId: string,
    readonly expectedPlanDigest: string,
    readonly pinnedPlanDigest: string,
    readonly generation: number
  ) {
    super(
      generation > 0
        ? `Execution ${executionId} was migrated to Plan ${pinnedPlanDigest}; coordinator Plan ${expectedPlanDigest} is stale`
        : `Execution ${executionId} is pinned to Plan ${pinnedPlanDigest}, not coordinator Plan ${expectedPlanDigest}`
    )
    this.name = "ExecutionMigratedError"
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
  /** Static node ids that already hold a durable terminal exit. */
  readonly committedNodeIds: readonly string[]
  /** Fan-out and loop template node ids that already own materialized children. */
  readonly materializedTemplateIds: readonly string[]
  /** childFlow node ids already linked to a durable child execution. */
  readonly linkedChildFlowIds: readonly string[]
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
 * - a template that already materialized dynamic children (fan-out items, loop
 *   rounds) or linked a child execution is frozen too, even while that template
 *   node is itself still running, because those durable child identities were
 *   derived from it; and
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
    ...evidence.linkedChildFlowIds
  ])
  for (const [id, beforeNode] of before) {
    const afterNode = after.get(id)!
    if (beforeNode.kind !== afterNode.kind) {
      reject(
        "node-kind-changed",
        `Migration changes node ${id} from ${beforeNode.kind} to ${afterNode.kind}`
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

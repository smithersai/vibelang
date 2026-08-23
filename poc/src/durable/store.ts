import { Database } from "bun:sqlite"
import { Buffer } from "node:buffer"
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { MAX_CHILD_FLOW_DEPTH, validateDeploymentManifest, validatePlanTemplate } from "./artifact.ts"
import {
  assertNodeMigrationCompatible,
  ExecutionMigratedError,
  isCommittedNodeStatus,
  MigrationRejectedError,
  planExecutionMigration,
  type ExecutionMigrationEvidence,
  type MigrationPlan
} from "./migration.ts"
import { WakeupService } from "./wakeup.ts"
import {
  allPlanNodes,
  assertJson,
  canonicalJson,
  decodeCanonicalJson,
  type DeploymentManifest,
  type DurableSchema,
  digest,
  type JsonValue,
  queueContractIdentity,
  signalContractIdentity,
  type SignalNode,
  type PlanTemplate,
  type StructuralDurableSchema,
  type WorkerExit
} from "./ir.ts"
import { validateDurableSchema, validateDurableValue } from "./schema.ts"

/**
 * Bound on how many suspended executions one post-COMMIT wakeup fan-out
 * notifies directly. Notification is a fast path only; anything beyond this
 * bound converges through each coordinator's persistent fallback sweep.
 */
const MAX_WAKEUP_FANOUT = 256

/** One bounded, portable, NUL-free identity string used at every entry point. */
const assertBoundedIdentity = (label: string, value: unknown, limit: number): string => {
  if (
    typeof value !== "string" || value.trim() === "" ||
    new TextEncoder().encode(value).byteLength > limit || value.includes("\0")
  ) {
    throw new TypeError(`Durable ${label} must be a bounded non-empty string`)
  }
  return value
}

export type ExecutionStatus = "running" | "completed" | "failed" | "cancelled"
export type NodeStatus = "pending" | "running" | "succeeded" | "failed" | "defect" | "skipped" | "cancelled"

interface ExecutionRow {
  readonly id: string
  readonly flow_id: string
  readonly plan_digest: string
  readonly manifest_digest: string
  readonly input_json: string
  readonly input_digest: string | null
  readonly deadline: number
  readonly status: ExecutionStatus
  readonly output_json: string | null
  readonly output_digest: string | null
  readonly error_json: string | null
  readonly error_digest: string | null
  readonly plan_generation?: number
}

interface NodeRow {
  readonly execution_id: string
  readonly node_id: string
  readonly node_kind: string | null
  readonly status: NodeStatus
  readonly attempt: number
  readonly fence: number
  readonly owner: string | null
  readonly lease_until: number | null
  readonly retry_at: number | null
  readonly wake_at: number | null
  readonly signal_waiting_at: number | null
  readonly queue_waiting_at: number | null
  readonly fanout_digest: string | null
  readonly result_json: string | null
  readonly result_digest: string | null
  readonly error_json: string | null
  readonly error_digest: string | null
  readonly adopted_from: string | null
}

interface CacheRow {
  readonly result_json: string
  readonly result_digest: string
  readonly input_digest?: string
}

interface SignalContractRow {
  readonly execution_id: string
  readonly node_id: string
  readonly signal_id: string
  readonly payload_schema_json: string
  readonly payload_schema_storage_digest: string
  readonly payload_schema_digest: string
  readonly contract_digest: string
  /** NULL is the original unicast form; "broadcast" selects the fan-out form. */
  readonly delivery: string | null
}

export type SignalInboxState = "pending" | "consumed" | "discarded"

interface SignalInboxRow {
  readonly execution_id: string
  readonly node_id: string
  readonly signal_id: string
  readonly idempotency_key: string
  readonly payload_json: string
  readonly payload_digest: string
  readonly schema_digest: string
  readonly delivery_digest: string
  readonly state: SignalInboxState
  readonly delivered_at: number
  readonly consumed_at: number | null
  readonly discarded_at: number | null
}

export interface StoredExecution {
  readonly id: string
  readonly status: ExecutionStatus
  readonly deadline: number
  readonly output?: JsonValue
  readonly error?: JsonValue
}

export interface FinishExecutionResult {
  readonly changed: boolean
  readonly execution: StoredExecution
}

export type CachedSuccessCommit =
  | { readonly kind: "committed"; readonly value: JsonValue }
  | { readonly kind: "lost" }

export type StoredNodeExit =
  | { readonly kind: "success"; readonly value: JsonValue; readonly adoptedFrom: string | null }
  | { readonly kind: "failure"; readonly error: JsonValue }
  | { readonly kind: "defect"; readonly defect: JsonValue }
  | { readonly kind: "skipped" }
  | { readonly kind: "cancelled"; readonly reason: JsonValue }

export type ClaimResult =
  | {
    readonly kind: "claimed"
    readonly attempt: number
    readonly fencingToken: number
    readonly leaseExpiresAt: number
    readonly stolen: boolean
  }
  | { readonly kind: "busy"; readonly leaseExpiresAt: number }
  | { readonly kind: "terminal"; readonly exit: StoredNodeExit }

export type TimerScheduleResult =
  | { readonly kind: "waiting"; readonly wakeAt: number; readonly newlyScheduled: boolean }
  | { readonly kind: "terminal"; readonly exit: StoredNodeExit }

export type StableFanOutKey = string | number | boolean

export interface FanOutMaterializationEntry {
  readonly key: StableFanOutKey
  readonly childNodeId: string
  /** Digest of the fully instantiated Action input for alias detection. */
  readonly inputDigest: string
  /**
   * Present exactly when the fan-out uses the multi-step (Plan format v2)
   * child identity derivation; the initial materialization is always step 0.
   * Legacy single-Action entries omit it and keep their original derivation
   * and materialization digest bytes.
   */
  readonly step?: 0
}

export interface FanOutMaterializationResult {
  readonly newlyMaterialized: boolean
  readonly digest: string
}

/** One lazily materialized later step of a multi-step fan-out template. */
export interface FanOutStepMaterializationRequest {
  readonly key: StableFanOutKey
  /** 1-based-onward step ordinal; step 0 is the initial keyed set. */
  readonly step: number
  readonly childNodeId: string
  /** Digest of the fully instantiated step input for alias detection. */
  readonly inputDigest: string
}

export interface FanOutStepMaterializationResult {
  readonly newlyMaterialized: boolean
}

/** One durable next-round handoff of a round-budgeted loop template. */
export interface LoopRoundMaterializationRequest {
  /** 0-based round ordinal. */
  readonly round: number
  readonly childNodeId: string
  /** Digest of the fully instantiated round Action input. */
  readonly inputDigest: string
  /** Digest of the durable state value the round was instantiated from. */
  readonly stateDigest: string
}

export interface LoopRoundMaterializationResult {
  readonly newlyMaterialized: boolean
}

export interface ChildExecutionLink {
  readonly nodeId: string
  readonly childExecutionId: string
  readonly planDigest: string
}

export interface ChildExecutionLinkResult {
  readonly newlyLinked: boolean
  readonly link: ChildExecutionLink
}

/** Provisional external delivery surface for the signal architecture POC. */
export interface SignalDeliveryRequest {
  readonly executionId: string
  readonly nodeId: string
  readonly signalId: string
  readonly idempotencyKey: string
  readonly payload: unknown
}

/**
 * Provisional sender evidence for one delivery. Exactly one field may be
 * present: a minted `senderToken` (the default, required path) or the explicit
 * `unsafeLocalDelivery` escape hatch retained for in-process tests/legacy
 * callers. An empty authorization fails closed.
 */
export interface SignalDeliveryAuthorization {
  /**
   * Opaque capability token minted by this store (or another connection to
   * the same database) and bound to exactly (executionId, signalId). This is
   * local-trust evidence — HMAC under a per-database secret — not remote
   * network authentication; anything that can read the database can mint one.
   */
  readonly senderToken?: string
  /** Explicit legacy escape hatch: trusted in-process delivery, no token. */
  readonly unsafeLocalDelivery?: true
}

/** Provisional minted delivery evidence for one (execution, signal) pair. */
export interface MintedSignalToken {
  readonly nodeId: string
  readonly senderToken: string
}

/** Trusted coordinator evidence; it is not supplied by an external sender. */
export interface SignalContractExpectation {
  readonly planDigest: string
  readonly signalId: string
  readonly signalContractDigest: string
}

export interface SignalDeliveryResult {
  readonly duplicate: boolean
  readonly state: SignalInboxState
  readonly payloadDigest: string
  readonly deliveryDigest: string
}

export type SignalPollResult =
  | { readonly kind: "waiting"; readonly newlyWaiting: boolean }
  | { readonly kind: "terminal"; readonly exit: StoredNodeExit; readonly newlyConsumed: boolean }

/** One durable enqueue request. Producers never supply schema authority. */
export interface QueueEnqueueRequest {
  readonly queueId: string
  readonly idempotencyKey: string
  readonly item: unknown
}

/** Trusted coordinator evidence for a queue; not supplied by a producer. */
export interface QueueContractExpectation {
  readonly queueId: string
  readonly queueContractDigest: string
}

export interface QueueEnqueueResult {
  readonly duplicate: boolean
  readonly sequence: number
  readonly state: QueueItemState
  readonly payloadDigest: string
  readonly itemDigest: string
}

export type QueueItemState = "pending" | "consumed"

export type QueuePollResult =
  | { readonly kind: "waiting"; readonly newlyWaiting: boolean }
  | {
    readonly kind: "terminal"
    readonly exit: StoredNodeExit
    readonly newlyConsumed: boolean
    readonly sequence?: number
  }

/** Trusted coordinator evidence for a queue consumer node. */
export interface QueuePollExpectation {
  readonly planDigest: string
  readonly queueId: string
  readonly queueContractDigest: string
}

/** One broadcast delivery request; it addresses a signal identity, not a run. */
export interface BroadcastDeliveryRequest {
  readonly signalId: string
  readonly idempotencyKey: string
  readonly payload: unknown
}

/** Trusted coordinator evidence for a broadcast signal identity. */
export interface BroadcastContractExpectation {
  readonly signalId: string
  readonly signalContractDigest: string
}

export interface BroadcastDeliveryResult {
  readonly duplicate: boolean
  readonly sequence: number
  readonly payloadDigest: string
  readonly deliveryDigest: string
  /** Subscribed, still-waiting executions entitled to this delivery. */
  readonly notifiedExecutions: readonly string[]
}

/** Result of one broadcast retention sweep. */
export interface BroadcastCollectionResult {
  readonly examined: number
  readonly deleted: number
}

/** Provisional minted producer evidence for one queue identity. */
export interface MintedQueueToken {
  readonly queueId: string
  readonly producerToken: string
}

/** Provisional minted sender evidence for one broadcast signal identity. */
export interface MintedBroadcastToken {
  readonly signalId: string
  readonly senderToken: string
}

export class QueueEnqueueConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QueueEnqueueConflictError"
  }
}

export class QueueEnqueueRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QueueEnqueueRejectedError"
  }
}

export class SignalDeliveryConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SignalDeliveryConflictError"
  }
}

export class SignalDeliveryRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SignalDeliveryRejectedError"
  }
}

export class SignalDeliveryUnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SignalDeliveryUnauthorizedError"
  }
}

export interface JournalEvent {
  readonly sequence: number
  readonly executionId: string
  readonly nodeId: string | null
  readonly type: string
  readonly payload: JsonValue
  readonly payloadDigest: string
  readonly eventDigest: string
  readonly timestamp: number
}

export class ContentIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ContentIntegrityError"
  }
}

const parseJson = (text: string, expectedDigest: string | null, label: string): JsonValue => {
  const value = decodeCanonicalJson(text, label)
  if (expectedDigest === null || digest(value) !== expectedDigest) {
    throw new ContentIntegrityError(`${label} failed persisted digest verification`)
  }
  return value
}

const storedExecution = (row: ExecutionRow): StoredExecution => ({
  id: row.id,
  status: row.status,
  deadline: row.deadline,
  ...(row.output_json === null ? {} : { output: parseJson(row.output_json, row.output_digest, `execution ${row.id} output`) }),
  ...(row.error_json === null ? {} : { error: parseJson(row.error_json, row.error_digest, `execution ${row.id} error`) })
})

const nodeExit = (row: NodeRow): StoredNodeExit | undefined => {
  switch (row.status) {
    case "succeeded":
      return {
        kind: "success",
        value: parseJson(row.result_json!, row.result_digest, `node ${row.execution_id}/${row.node_id} result`),
        adoptedFrom: row.adopted_from
      }
    case "failed":
      return { kind: "failure", error: parseJson(row.error_json!, row.error_digest, `node ${row.execution_id}/${row.node_id} failure`) }
    case "defect":
      return { kind: "defect", defect: parseJson(row.error_json!, row.error_digest, `node ${row.execution_id}/${row.node_id} defect`) }
    case "skipped":
      return { kind: "skipped" }
    case "cancelled":
      return { kind: "cancelled", reason: parseJson(row.error_json!, row.error_digest, `node ${row.execution_id}/${row.node_id} cancellation`) }
    case "pending":
    case "running":
      return undefined
  }
}

export class DurableStore {
  readonly database: Database
  /**
   * In-process wakeup notifier for coordinators suspended on this store
   * instance. Best-effort fast path only; see WakeupService for the sweep
   * guarantee that makes correctness independent of any notification.
   */
  readonly wakeups = new WakeupService()
  /** Per-database signal-transport secret, loaded or created at initialization. */
  private readonly signalTokenSecret: Buffer

  constructor(filename = ":memory:") {
    this.database = new Database(filename, { create: true, strict: true })
    this.database.exec("PRAGMA journal_mode = WAL")
    this.database.exec("PRAGMA synchronous = FULL")
    // Every read-then-write transaction below runs via .immediate() (BEGIN
    // IMMEDIATE): the write lock is taken up front, where this busy handler
    // can wait for a concurrent writer. A DEFERRED transaction that reads
    // first would instead fail its later lock upgrade with an immediate
    // SQLITE_BUSY or SQLITE_BUSY_SNAPSHOT that the busy handler never
    // retries, turning transient cross-connection contention into a throw.
    this.database.exec("PRAGMA busy_timeout = 5000")
    this.database.exec("PRAGMA foreign_keys = ON")
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS durable_executions (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        plan_digest TEXT NOT NULL,
        manifest_digest TEXT NOT NULL,
        input_json TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        status TEXT NOT NULL,
        output_json TEXT,
        output_digest TEXT,
        error_json TEXT,
        error_digest TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS durable_nodes (
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        node_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        fence INTEGER NOT NULL DEFAULT 0,
        owner TEXT,
        lease_until INTEGER,
        retry_at INTEGER,
        wake_at INTEGER,
        signal_waiting_at INTEGER,
        fanout_digest TEXT,
        result_json TEXT,
        result_digest TEXT,
        error_json TEXT,
        error_digest TEXT,
        adopted_from TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (execution_id, node_id),
        FOREIGN KEY (execution_id) REFERENCES durable_executions(id)
      );
      CREATE TABLE IF NOT EXISTS durable_signal_contracts (
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        signal_id TEXT NOT NULL,
        payload_schema_json TEXT NOT NULL,
        payload_schema_storage_digest TEXT NOT NULL,
        payload_schema_digest TEXT NOT NULL,
        contract_digest TEXT NOT NULL,
        PRIMARY KEY (execution_id, node_id),
        UNIQUE (execution_id, signal_id),
        FOREIGN KEY (execution_id, node_id) REFERENCES durable_nodes(execution_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS durable_signal_inbox (
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        signal_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        schema_digest TEXT NOT NULL,
        delivery_digest TEXT NOT NULL,
        state TEXT NOT NULL,
        delivered_at INTEGER NOT NULL,
        consumed_at INTEGER,
        discarded_at INTEGER,
        PRIMARY KEY (execution_id, node_id),
        UNIQUE (execution_id, node_id, idempotency_key),
        FOREIGN KEY (execution_id, node_id) REFERENCES durable_signal_contracts(execution_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS durable_fanout_items (
        execution_id TEXT NOT NULL,
        fanout_node_id TEXT NOT NULL,
        key_json TEXT NOT NULL,
        step INTEGER NOT NULL DEFAULT 0,
        child_node_id TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        PRIMARY KEY (execution_id, fanout_node_id, key_json, step),
        UNIQUE (execution_id, child_node_id),
        FOREIGN KEY (execution_id, fanout_node_id) REFERENCES durable_nodes(execution_id, node_id),
        FOREIGN KEY (execution_id, child_node_id) REFERENCES durable_nodes(execution_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS durable_loop_rounds (
        execution_id TEXT NOT NULL,
        loop_node_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        child_node_id TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        state_digest TEXT NOT NULL,
        PRIMARY KEY (execution_id, loop_node_id, round),
        UNIQUE (execution_id, child_node_id),
        FOREIGN KEY (execution_id, loop_node_id) REFERENCES durable_nodes(execution_id, node_id),
        FOREIGN KEY (execution_id, child_node_id) REFERENCES durable_nodes(execution_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS durable_child_executions (
        parent_execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        child_execution_id TEXT NOT NULL,
        plan_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (parent_execution_id, node_id),
        UNIQUE (child_execution_id),
        FOREIGN KEY (parent_execution_id, node_id) REFERENCES durable_nodes(execution_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS durable_journal (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        node_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        event_digest TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS durable_memo (
        scope TEXT NOT NULL,
        generation TEXT NOT NULL,
        memo_key TEXT NOT NULL,
        result_json TEXT NOT NULL,
        result_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (scope, generation, memo_key)
      );
      CREATE TABLE IF NOT EXISTS durable_content_cache (
        content_key TEXT PRIMARY KEY,
        input_digest TEXT NOT NULL,
        result_json TEXT NOT NULL,
        result_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS durable_signal_secret (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        secret_hex TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- Cross-execution registry: one queue identity has exactly one pinned
      -- compiler-derived item contract, so no producer supplies type authority
      -- and two Flows cannot disagree about a shared queue's items.
      CREATE TABLE IF NOT EXISTS durable_queues (
        queue_id TEXT PRIMARY KEY,
        item_schema_json TEXT NOT NULL,
        item_schema_storage_digest TEXT NOT NULL,
        item_schema_digest TEXT NOT NULL,
        contract_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS durable_queue_contracts (
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        queue_id TEXT NOT NULL,
        contract_digest TEXT NOT NULL,
        PRIMARY KEY (execution_id, node_id),
        FOREIGN KEY (execution_id, node_id) REFERENCES durable_nodes(execution_id, node_id),
        FOREIGN KEY (queue_id) REFERENCES durable_queues(queue_id)
      );
      -- FIFO is commit order: the autoincrement sequence is assigned inside the
      -- enqueue transaction, so a reader can never observe an out-of-order gap.
      CREATE TABLE IF NOT EXISTS durable_queue_items (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        queue_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        schema_digest TEXT NOT NULL,
        item_digest TEXT NOT NULL,
        state TEXT NOT NULL,
        enqueued_at INTEGER NOT NULL,
        consumed_at INTEGER,
        consumed_execution_id TEXT,
        consumed_node_id TEXT,
        UNIQUE (queue_id, idempotency_key),
        FOREIGN KEY (queue_id) REFERENCES durable_queues(queue_id)
      );
      -- Cross-execution registry for the broadcast signal form. A broadcast
      -- identity is a different contract from a unicast identity of the same
      -- name, so ambiguity between the two fails closed here.
      CREATE TABLE IF NOT EXISTS durable_broadcast_signals (
        signal_id TEXT PRIMARY KEY,
        payload_schema_json TEXT NOT NULL,
        payload_schema_storage_digest TEXT NOT NULL,
        payload_schema_digest TEXT NOT NULL,
        contract_digest TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS durable_broadcast_deliveries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        schema_digest TEXT NOT NULL,
        delivery_digest TEXT NOT NULL,
        delivered_at INTEGER NOT NULL,
        UNIQUE (signal_id, idempotency_key),
        FOREIGN KEY (signal_id) REFERENCES durable_broadcast_signals(signal_id)
      );
      -- The durable subscription point. A waiter is entitled to exactly the
      -- deliveries committed strictly after its own watermark, so a late
      -- execution never retro-consumes an old broadcast.
      CREATE TABLE IF NOT EXISTS durable_broadcast_subscriptions (
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        signal_id TEXT NOT NULL,
        watermark INTEGER NOT NULL,
        subscribed_at INTEGER NOT NULL,
        PRIMARY KEY (execution_id, node_id),
        FOREIGN KEY (execution_id, node_id) REFERENCES durable_nodes(execution_id, node_id)
      );
      -- Per-waiter consumption evidence. It is self-sufficient (it carries the
      -- payload digest) so a delivery may be garbage collected without
      -- weakening a consumer's later integrity re-verification.
      CREATE TABLE IF NOT EXISTS durable_broadcast_consumptions (
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        signal_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        delivery_digest TEXT NOT NULL,
        consumed_at INTEGER NOT NULL,
        PRIMARY KEY (execution_id, node_id),
        FOREIGN KEY (execution_id, node_id) REFERENCES durable_nodes(execution_id, node_id)
      );
    `)
    this.ensureColumn("durable_executions", "input_digest", "TEXT")
    this.ensureColumn("durable_executions", "output_digest", "TEXT")
    this.ensureColumn("durable_executions", "error_digest", "TEXT")
    this.ensureColumn("durable_nodes", "result_digest", "TEXT")
    this.ensureColumn("durable_nodes", "error_digest", "TEXT")
    this.ensureColumn("durable_nodes", "node_kind", "TEXT")
    this.ensureColumn("durable_nodes", "wake_at", "INTEGER")
    this.ensureColumn("durable_nodes", "signal_waiting_at", "INTEGER")
    this.ensureColumn("durable_nodes", "fanout_digest", "TEXT")
    this.ensureColumn("durable_nodes", "queue_waiting_at", "INTEGER")
    this.ensureColumn("durable_journal", "payload_digest", "TEXT")
    this.ensureColumn("durable_journal", "event_digest", "TEXT")
    // NULL means the original unicast form, so no pre-existing row changes.
    this.ensureColumn("durable_signal_contracts", "delivery", "TEXT")
    // 0 means "never migrated"; each applied migration increments it.
    this.ensureColumn("durable_executions", "plan_generation", "INTEGER NOT NULL DEFAULT 0")
    this.migrateFanOutItemsStepIdentity()
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS durable_signal_contracts_signal
        ON durable_signal_contracts(signal_id);
      CREATE INDEX IF NOT EXISTS durable_queue_items_head
        ON durable_queue_items(queue_id, state, sequence);
      CREATE INDEX IF NOT EXISTS durable_queue_contracts_queue
        ON durable_queue_contracts(queue_id);
      CREATE INDEX IF NOT EXISTS durable_broadcast_deliveries_signal
        ON durable_broadcast_deliveries(signal_id, sequence);
      CREATE INDEX IF NOT EXISTS durable_broadcast_subscriptions_signal
        ON durable_broadcast_subscriptions(signal_id, watermark);
    `)
    this.signalTokenSecret = this.initializeSignalTokenSecret()
  }

  /**
   * Loads or creates the per-database signal-transport secret. The secret is
   * one committed boundary: a process may die immediately after creating it,
   * and every later connection to the same database file must converge on the
   * same bytes so previously minted sender tokens keep verifying.
   */
  private initializeSignalTokenSecret(): Buffer {
    const transaction = this.database.transaction((): string => {
      const existing = this.database.query(
        "SELECT secret_hex FROM durable_signal_secret WHERE id = 1"
      ).get() as { readonly secret_hex: string } | null
      if (existing !== null) return existing.secret_hex
      const secretHex = randomBytes(32).toString("hex")
      this.database.query(
        "INSERT INTO durable_signal_secret(id,secret_hex,created_at) VALUES(1,?,?)"
      ).run(secretHex, Date.now())
      return secretHex
    })
    const secretHex = transaction.immediate()
    if (typeof secretHex !== "string" || !/^[0-9a-f]{64}$/.test(secretHex)) {
      throw new ContentIntegrityError("durable signal transport secret is corrupt")
    }
    return Buffer.from(secretHex, "hex")
  }

  /** Deterministic HMAC token over exactly (executionId, signalId). */
  private computeSignalToken(executionId: string, signalId: string): string {
    const mac = createHmac("sha256", this.signalTokenSecret)
      .update(canonicalJson({ formatVersion: 1, executionId, signalId }))
      .digest("hex")
    return `vst1_${mac}`
  }

  /**
   * Provisional grant seam: mints an opaque sender token bound to exactly
   * (executionId, signalId), fail-closed unless that execution pinned a
   * contract for that signal at initialization. The token is stateless — no
   * grant row is persisted, so minting itself commits nothing — and it is
   * honestly local-trust evidence, not remote-network authentication: any
   * principal with read access to the database can derive the same secret.
   */
  mintSignalToken(executionId: string, signalId: string): MintedSignalToken {
    for (const [label, value, limit] of [
      ["execution id", executionId, 512],
      ["signal id", signalId, 128]
    ] as const) {
      if (
        typeof value !== "string" || value.trim() === "" ||
        new TextEncoder().encode(value).byteLength > limit || value.includes("\0")
      ) {
        throw new TypeError(`Durable signal ${label} must be a bounded non-empty string`)
      }
    }
    const contract = this.database.query(
      "SELECT node_id FROM durable_signal_contracts WHERE execution_id=? AND signal_id=?"
    ).get(executionId, signalId) as { readonly node_id: string } | null
    if (contract === null) {
      throw new SignalDeliveryRejectedError(
        `Cannot mint a sender token: execution ${executionId} has no pinned contract for signal ${signalId}`
      )
    }
    return { nodeId: contract.node_id, senderToken: this.computeSignalToken(executionId, signalId) }
  }

  /** Deterministic HMAC token over exactly one queue identity. */
  private computeQueueToken(queueId: string): string {
    const mac = createHmac("sha256", this.signalTokenSecret)
      .update(canonicalJson({ formatVersion: 1, queueId }))
      .digest("hex")
    return `vqt1_${mac}`
  }

  /** Deterministic HMAC token over exactly one broadcast signal identity. */
  private computeBroadcastToken(signalId: string): string {
    const mac = createHmac("sha256", this.signalTokenSecret)
      .update(canonicalJson({ formatVersion: 1, broadcastSignalId: signalId }))
      .digest("hex")
    return `vbt1_${mac}`
  }

  /**
   * Mints producer evidence for one queue identity, fail-closed unless some
   * coordinator already pinned that queue's compiler-derived item contract.
   * Like the signal token, this is local-trust evidence over one SQLite file,
   * not remote authentication.
   */
  mintQueueToken(queueId: string): MintedQueueToken {
    assertBoundedIdentity("queue id", queueId, 128)
    const registry = this.database.query(
      "SELECT queue_id FROM durable_queues WHERE queue_id=?"
    ).get(queueId) as { readonly queue_id: string } | null
    if (registry === null) {
      throw new QueueEnqueueRejectedError(
        `Cannot mint a producer token: queue ${queueId} has no pinned item contract`
      )
    }
    return { queueId, producerToken: this.computeQueueToken(queueId) }
  }

  /** Mints sender evidence for one already-pinned broadcast signal identity. */
  mintBroadcastToken(signalId: string): MintedBroadcastToken {
    assertBoundedIdentity("signal id", signalId, 128)
    const registry = this.database.query(
      "SELECT signal_id FROM durable_broadcast_signals WHERE signal_id=?"
    ).get(signalId) as { readonly signal_id: string } | null
    if (registry === null) {
      throw new SignalDeliveryRejectedError(
        `Cannot mint a broadcast sender token: signal ${signalId} has no pinned broadcast contract`
      )
    }
    return { signalId, senderToken: this.computeBroadcastToken(signalId) }
  }

  /**
   * Mints delivery evidence for a signal inside an ATTACHED child execution,
   * gated on the durable parent -> child linkage chain rather than on any new
   * capability. The caller must already be entitled to `parentExecutionId`; a
   * child that is not durably attached along `childNodePath` fails closed, so
   * this widens a parent grant's reach only to executions the parent itself
   * created.
   */
  mintAttachedSignalToken(
    parentExecutionId: string,
    childNodePath: readonly string[],
    signalId: string
  ): MintedSignalToken & { readonly executionId: string } {
    assertBoundedIdentity("execution id", parentExecutionId, 512)
    assertBoundedIdentity("signal id", signalId, 128)
    if (!Array.isArray(childNodePath) || childNodePath.length === 0 || childNodePath.length > MAX_CHILD_FLOW_DEPTH) {
      throw new TypeError(
        `Durable child signal path must name 1..${MAX_CHILD_FLOW_DEPTH} attached childFlow nodes`
      )
    }
    let executionId = parentExecutionId
    for (const [index, nodeId] of childNodePath.entries()) {
      assertBoundedIdentity(`child path node id ${index}`, nodeId, 512)
      const link = this.database.query(
        "SELECT child_execution_id FROM durable_child_executions WHERE parent_execution_id=? AND node_id=?"
      ).get(executionId, nodeId) as { readonly child_execution_id: string } | null
      if (link === null) {
        throw new SignalDeliveryRejectedError(
          `Durable execution ${executionId} has no attached child at childFlow node ${nodeId}`
        )
      }
      executionId = link.child_execution_id
    }
    const minted = this.mintSignalToken(executionId, signalId)
    return { executionId, nodeId: minted.nodeId, senderToken: minted.senderToken }
  }

  /**
   * Fails closed when a caller addresses an execution that is not pinned to the
   * caller's Plan. Every mutating coordinator entry point routes through this,
   * so a coordinator holding a superseded deployment cannot claim, materialize,
   * link, complete, or fail an execution that has since been migrated.
   */
  private assertPinnedPlan(executionId: string, expectedPlanDigest: string | undefined): void {
    if (expectedPlanDigest === undefined) return
    if (typeof expectedPlanDigest !== "string" || !/^[0-9a-f]{64}$/.test(expectedPlanDigest)) {
      throw new TypeError("Durable pinned Plan digest expectation is invalid")
    }
    const row = this.database.query(
      "SELECT plan_digest,plan_generation FROM durable_executions WHERE id=?"
    ).get(executionId) as { readonly plan_digest: string; readonly plan_generation: number } | null
    if (row === null) throw new Error(`Unknown durable execution ${executionId}`)
    if (row.plan_digest !== expectedPlanDigest) {
      throw new ExecutionMigratedError(executionId, expectedPlanDigest, row.plan_digest, row.plan_generation)
    }
  }

  /**
   * Fail-closed sender authorization for one delivery. Exactly one evidence
   * field is accepted; a structurally hostile authorization value is a
   * TypeError, and absent/malformed/mismatched token evidence is an
   * unauthorized rejection before any execution state is read, so an
   * unauthenticated sender cannot probe execution existence. Token comparison
   * is timing-safe over fixed-length digests of both candidate and expected.
   */
  private authorizeSignalDelivery(request: SignalDeliveryRequest, authorization: unknown): void {
    this.authorizeOpaqueToken(
      authorization,
      "senderToken",
      "signal delivery",
      () => this.computeSignalToken(request.executionId, request.signalId),
      "Durable signal delivery requires a minted sender token or explicit unsafeLocalDelivery",
      `Sender token does not authorize signal ${request.signalId} on execution ${request.executionId}`,
      SignalDeliveryUnauthorizedError
    )
  }

  /**
   * Shared fail-closed evidence check for every opaque local-trust token in
   * this store. Exactly one evidence field is accepted; a structurally hostile
   * authorization value is a TypeError, and absent/malformed/mismatched token
   * evidence is rejected before any state is read, so an unauthorized caller
   * cannot probe existence. Comparison is timing-safe over fixed-length digests
   * of both candidate and expected token.
   */
  private authorizeOpaqueToken(
    authorization: unknown,
    tokenField: "senderToken" | "producerToken",
    surface: string,
    expectedToken: () => string,
    missingMessage: string,
    mismatchMessage: string,
    Unauthorized: new (message: string) => Error
  ): void {
    if (authorization === null || typeof authorization !== "object" || Array.isArray(authorization)) {
      throw new TypeError(`Durable ${surface} authorization must be an object`)
    }
    const keys = Reflect.ownKeys(authorization)
    if (keys.some((key) => key !== tokenField && key !== "unsafeLocalDelivery")) {
      throw new TypeError(`Durable ${surface} authorization has unknown fields`)
    }
    if (keys.length > 1) {
      throw new TypeError(`Durable ${surface} authorization must supply exactly one evidence field`)
    }
    if (keys[0] === "unsafeLocalDelivery") {
      if ((authorization as { readonly unsafeLocalDelivery?: unknown }).unsafeLocalDelivery !== true) {
        throw new TypeError(`Durable ${surface} unsafeLocalDelivery must be exactly true`)
      }
      return
    }
    const candidate: unknown = keys[0] === tokenField
      ? (authorization as Record<string, unknown>)[tokenField]
      : undefined
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) {
      throw new Unauthorized(missingMessage)
    }
    const candidateDigest = createHash("sha256").update(candidate, "utf8").digest()
    const expectedDigest = createHash("sha256").update(expectedToken(), "utf8").digest()
    if (!timingSafeEqual(candidateDigest, expectedDigest)) {
      throw new Unauthorized(mismatchMessage)
    }
  }

  private ensureColumn(table: string, column: string, declaration: string): void {
    const columns = this.database.query(`PRAGMA table_info(${table})`).all() as readonly { readonly name: string }[]
    if (!columns.some((entry) => entry.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
    }
  }

  /**
   * A pre-multi-step database keyed fan-out rows by (execution, node, key)
   * only. Rebuild that table once so the step ordinal joins the primary key;
   * every legacy row is exactly step 0 of its template.
   */
  private migrateFanOutItemsStepIdentity(): void {
    const columns = this.database.query("PRAGMA table_info(durable_fanout_items)").all() as readonly {
      readonly name: string
    }[]
    if (columns.some((entry) => entry.name === "step")) return
    this.database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE durable_fanout_items RENAME TO durable_fanout_items_legacy;
      CREATE TABLE durable_fanout_items (
        execution_id TEXT NOT NULL,
        fanout_node_id TEXT NOT NULL,
        key_json TEXT NOT NULL,
        step INTEGER NOT NULL DEFAULT 0,
        child_node_id TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        PRIMARY KEY (execution_id, fanout_node_id, key_json, step),
        UNIQUE (execution_id, child_node_id),
        FOREIGN KEY (execution_id, fanout_node_id) REFERENCES durable_nodes(execution_id, node_id),
        FOREIGN KEY (execution_id, child_node_id) REFERENCES durable_nodes(execution_id, node_id)
      );
      INSERT INTO durable_fanout_items(execution_id,fanout_node_id,key_json,step,child_node_id,input_digest)
        SELECT execution_id,fanout_node_id,key_json,0,child_node_id,input_digest FROM durable_fanout_items_legacy;
      DROP TABLE durable_fanout_items_legacy;
      COMMIT;
    `)
  }

  close(): void {
    this.database.close()
  }

  private emit(
    executionId: string,
    nodeId: string | null,
    type: string,
    payload: unknown,
    timestamp = Date.now()
  ): void {
    const normalizedPayload = assertJson(payload, `journal ${type} payload`)
    const payloadJson = canonicalJson(normalizedPayload)
    const payloadDigest = digest(normalizedPayload)
    const inserted = this.database.query(
      `INSERT INTO durable_journal(
        execution_id,node_id,type,payload_json,payload_digest,event_digest,timestamp
      ) VALUES(?,?,?,?,?,'',?)`
    ).run(executionId, nodeId, type, payloadJson, payloadDigest, timestamp)
    const sequence = Number(inserted.lastInsertRowid)
    const eventDigest = digest({
      sequence,
      executionId,
      nodeId,
      type,
      payload: normalizedPayload,
      timestamp
    })
    this.database.query("UPDATE durable_journal SET event_digest=? WHERE sequence=?")
      .run(eventDigest, sequence)
  }

  private signalContract(executionId: string, nodeId: string): {
    readonly row: SignalContractRow
    readonly schema: Extract<DurableSchema, { readonly shape: "structural" }>
    readonly broadcast: boolean
  } {
    const row = this.database.query(
      "SELECT * FROM durable_signal_contracts WHERE execution_id=? AND node_id=?"
    ).get(executionId, nodeId) as SignalContractRow | null
    if (row === null) throw new ContentIntegrityError(`signal ${executionId}/${nodeId} is missing its persisted contract`)
    let decoded: JsonValue
    try {
      decoded = decodeCanonicalJson(row.payload_schema_json, `signal ${executionId}/${nodeId} schema`)
    } catch (error) {
      throw new ContentIntegrityError(
        `signal ${executionId}/${nodeId} schema is corrupt: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (digest(decoded) !== row.payload_schema_storage_digest) {
      throw new ContentIntegrityError(`signal ${executionId}/${nodeId} schema failed persisted digest verification`)
    }
    let schema: DurableSchema
    try {
      schema = validateDurableSchema(decoded, "input", `signal ${executionId}/${nodeId} schema`)
    } catch (error) {
      throw new ContentIntegrityError(
        `signal ${executionId}/${nodeId} has invalid schema evidence: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (schema.shape !== "structural" || schema.source !== "compiler-derived") {
      throw new ContentIntegrityError(`signal ${executionId}/${nodeId} does not have a structural compiler schema`)
    }
    if (row.delivery !== null && row.delivery !== "broadcast") {
      throw new ContentIntegrityError(`signal ${executionId}/${nodeId} has an unsupported persisted delivery mode`)
    }
    const delivery = row.delivery === "broadcast" ? "broadcast" as const : undefined
    if (
      schema.digest !== row.payload_schema_digest ||
      signalContractIdentity(row.signal_id, schema, delivery) !== row.contract_digest
    ) {
      throw new ContentIntegrityError(`signal ${executionId}/${nodeId} contract digest mismatch`)
    }
    return { row, schema, broadcast: delivery === "broadcast" }
  }

  /**
   * Reads and verifies the queue contract pinned for one consumer node, and the
   * cross-execution registry row it must agree with. The item schema comes only
   * from Plan initialization; a producer never supplies type authority.
   */
  private queueContract(executionId: string, nodeId: string): {
    readonly queueId: string
    readonly contractDigest: string
    readonly schema: StructuralDurableSchema
    readonly schemaDigest: string
  } {
    const row = this.database.query(
      "SELECT * FROM durable_queue_contracts WHERE execution_id=? AND node_id=?"
    ).get(executionId, nodeId) as {
      readonly queue_id: string
      readonly contract_digest: string
    } | null
    if (row === null) {
      throw new ContentIntegrityError(`queue ${executionId}/${nodeId} is missing its persisted contract`)
    }
    const registry = this.queueRegistry(row.queue_id)
    if (registry.contractDigest !== row.contract_digest) {
      throw new ContentIntegrityError(
        `queue ${executionId}/${nodeId} disagrees with the pinned registry contract for ${row.queue_id}`
      )
    }
    return {
      queueId: row.queue_id,
      contractDigest: row.contract_digest,
      schema: registry.schema,
      schemaDigest: registry.schemaDigest
    }
  }

  /** Verified cross-execution queue registry row for one queue identity. */
  private queueRegistry(queueId: string): {
    readonly schema: StructuralDurableSchema
    readonly schemaDigest: string
    readonly contractDigest: string
  } {
    const row = this.database.query(
      "SELECT * FROM durable_queues WHERE queue_id=?"
    ).get(queueId) as {
      readonly item_schema_json: string
      readonly item_schema_storage_digest: string
      readonly item_schema_digest: string
      readonly contract_digest: string
    } | null
    if (row === null) throw new QueueEnqueueRejectedError(`Durable queue ${queueId} has no pinned item contract`)
    const schema = this.verifiedStoredSchema(
      row.item_schema_json,
      row.item_schema_storage_digest,
      row.item_schema_digest,
      `queue ${queueId} item schema`
    )
    if (queueContractIdentity(queueId, schema) !== row.contract_digest) {
      throw new ContentIntegrityError(`queue ${queueId} registry contract digest mismatch`)
    }
    return { schema, schemaDigest: row.item_schema_digest, contractDigest: row.contract_digest }
  }

  /** Verified cross-execution broadcast registry row for one signal identity. */
  private broadcastRegistry(signalId: string): {
    readonly schema: StructuralDurableSchema
    readonly schemaDigest: string
    readonly contractDigest: string
  } {
    const row = this.database.query(
      "SELECT * FROM durable_broadcast_signals WHERE signal_id=?"
    ).get(signalId) as {
      readonly payload_schema_json: string
      readonly payload_schema_storage_digest: string
      readonly payload_schema_digest: string
      readonly contract_digest: string
    } | null
    if (row === null) {
      throw new SignalDeliveryRejectedError(`Durable broadcast signal ${signalId} has no pinned contract`)
    }
    const schema = this.verifiedStoredSchema(
      row.payload_schema_json,
      row.payload_schema_storage_digest,
      row.payload_schema_digest,
      `broadcast ${signalId} payload schema`
    )
    if (signalContractIdentity(signalId, schema, "broadcast") !== row.contract_digest) {
      throw new ContentIntegrityError(`broadcast ${signalId} registry contract digest mismatch`)
    }
    return { schema, schemaDigest: row.payload_schema_digest, contractDigest: row.contract_digest }
  }

  /** Decodes and re-verifies one persisted compiler-derived structural schema. */
  private verifiedStoredSchema(
    schemaJson: string,
    storageDigest: string,
    schemaDigest: string,
    label: string
  ): StructuralDurableSchema {
    let decoded: JsonValue
    try {
      decoded = decodeCanonicalJson(schemaJson, label)
    } catch (error) {
      throw new ContentIntegrityError(
        `${label} is corrupt: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (digest(decoded) !== storageDigest) {
      throw new ContentIntegrityError(`${label} failed persisted digest verification`)
    }
    let schema: DurableSchema
    try {
      schema = validateDurableSchema(decoded, "input", label)
    } catch (error) {
      throw new ContentIntegrityError(
        `${label} is invalid evidence: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (schema.shape !== "structural" || schema.source !== "compiler-derived" || schema.digest !== schemaDigest) {
      throw new ContentIntegrityError(`${label} is not an exact compiler-derived structural schema`)
    }
    return schema
  }

  private signalInbox(
    contract: SignalContractRow,
    row: SignalInboxRow
  ): { readonly payload: JsonValue; readonly result: SignalDeliveryResult } {
    const label = `signal ${row.execution_id}/${row.node_id} delivery`
    if (
      row.execution_id !== contract.execution_id || row.node_id !== contract.node_id ||
      row.signal_id !== contract.signal_id || row.schema_digest !== contract.payload_schema_digest ||
      !["pending", "consumed", "discarded"].includes(row.state) ||
      !Number.isSafeInteger(row.delivered_at) || row.delivered_at < 0 ||
      (row.consumed_at !== null && (!Number.isSafeInteger(row.consumed_at) || row.consumed_at < row.delivered_at)) ||
      (row.discarded_at !== null && (!Number.isSafeInteger(row.discarded_at) || row.discarded_at < row.delivered_at)) ||
      (row.state === "pending" && (row.consumed_at !== null || row.discarded_at !== null)) ||
      (row.state === "consumed" && (row.consumed_at === null || row.discarded_at !== null)) ||
      (row.state === "discarded" && (row.discarded_at === null || row.consumed_at !== null))
    ) {
      throw new ContentIntegrityError(`${label} has corrupt identity or state metadata`)
    }
    const { schema } = this.signalContract(row.execution_id, row.node_id)
    const payload = parseJson(row.payload_json, row.payload_digest, `${label} payload`)
    try {
      validateDurableValue(schema, payload, `${label} payload`)
    } catch (error) {
      throw new ContentIntegrityError(
        `${label} violates its persisted schema: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const expectedDeliveryDigest = digest({
      formatVersion: 1,
      executionId: row.execution_id,
      nodeId: row.node_id,
      signalId: row.signal_id,
      idempotencyKey: row.idempotency_key,
      payloadDigest: row.payload_digest,
      schemaDigest: row.schema_digest,
      deliveredAt: row.delivered_at
    })
    if (row.delivery_digest !== expectedDeliveryDigest) {
      throw new ContentIntegrityError(`${label} digest mismatch`)
    }
    return {
      payload,
      result: {
        duplicate: true,
        state: row.state,
        payloadDigest: row.payload_digest,
        deliveryDigest: row.delivery_digest
      }
    }
  }

  private discardSignalInbox(executionId: string, nodeId: string, reason: string, now: number): void {
    const row = this.database.query(
      "SELECT * FROM durable_signal_inbox WHERE execution_id=? AND node_id=?"
    ).get(executionId, nodeId) as SignalInboxRow | null
    if (row === null) return
    const contract = this.signalContract(executionId, nodeId).row
    this.signalInbox(contract, row)
    if (row.state !== "pending") return
    const update = this.database.query(
      `UPDATE durable_signal_inbox SET state='discarded',discarded_at=?
       WHERE execution_id=? AND node_id=? AND state='pending'`
    ).run(now, executionId, nodeId)
    if (update.changes === 1) {
      this.emit(executionId, nodeId, "signal_discarded", {
        signalId: row.signal_id,
        idempotencyKey: row.idempotency_key,
        payloadDigest: row.payload_digest,
        reason
      }, now)
    }
  }

  initializeExecution(
    executionId: string,
    plan: PlanTemplate,
    manifest: DeploymentManifest,
    input: JsonValue,
    deadline = Date.now() + 60_000
  ): StoredExecution {
    if (typeof executionId !== "string" || executionId.trim() === "") {
      throw new TypeError("Durable execution id must be non-empty")
    }
    if (!Number.isSafeInteger(deadline) || deadline < 0) {
      throw new TypeError("Durable execution deadline must be a non-negative safe integer")
    }
    const validatedPlan = validatePlanTemplate(plan)
    const validatedManifest = validateDeploymentManifest(manifest, validatedPlan)
    const normalizedInput = assertJson(input, "Flow input")
    const inputJson = canonicalJson(normalizedInput)
    const inputDigest = digest(normalizedInput)
    const now = Date.now()
    const transaction = this.database.transaction(() => {
      const existing = this.database.query("SELECT * FROM durable_executions WHERE id = ?").get(executionId) as
        | ExecutionRow
        | null
      if (existing !== null) {
        // A coordinator whose Flow identity and input agree but whose pinned
        // digests do not is a version skew, not corruption. Reporting it as a
        // migration keeps a superseded coordinator from mistaking a redeploy
        // for a durable integrity failure.
        if (
          existing.flow_id === validatedPlan.flowId &&
          existing.input_json === inputJson &&
          existing.input_digest === inputDigest &&
          (existing.plan_digest !== validatedPlan.digest || existing.manifest_digest !== validatedManifest.digest)
        ) {
          throw new ExecutionMigratedError(
            executionId,
            validatedPlan.digest,
            existing.plan_digest,
            existing.plan_generation ?? 0
          )
        }
        if (
          existing.flow_id !== validatedPlan.flowId ||
          existing.plan_digest !== validatedPlan.digest ||
          existing.manifest_digest !== validatedManifest.digest ||
          existing.input_json !== inputJson ||
          existing.input_digest !== inputDigest
        ) {
          throw new Error(
            `Execution ${executionId} is pinned to different input, Plan IR, schemas, or deployment manifest`
          )
        }
        return existing
      }
      this.database.query(
        `INSERT INTO durable_executions(
          id,flow_id,plan_digest,manifest_digest,input_json,input_digest,deadline,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,'running',?,?)`
      ).run(executionId, validatedPlan.flowId, validatedPlan.digest, validatedManifest.digest, inputJson, inputDigest, deadline, now, now)
      for (const node of allPlanNodes(validatedPlan)) {
        this.database.query(
          `INSERT INTO durable_nodes(execution_id,node_id,node_kind,status,attempt,fence,updated_at)
           VALUES(?,?,?,'pending',0,0,?)`
        ).run(executionId, node.id, node.kind, now)
        if (node.kind === "signal") {
          const schemaJson = canonicalJson(node.payloadSchema)
          const broadcast = node.delivery === "broadcast"
          // Ambiguity between the two delivery forms fails closed in both
          // directions before any contract row exists for this execution.
          const registered = this.database.query(
            "SELECT contract_digest FROM durable_broadcast_signals WHERE signal_id=?"
          ).get(node.signalId) as { readonly contract_digest: string } | null
          if (broadcast) {
            const unicast = this.database.query(
              `SELECT execution_id FROM durable_signal_contracts
               WHERE signal_id=? AND (delivery IS NULL OR delivery<>'broadcast') LIMIT 1`
            ).get(node.signalId) as { readonly execution_id: string } | null
            if (unicast !== null) {
              throw new SignalDeliveryConflictError(
                `Signal identity ${node.signalId} is already pinned as a single-delivery signal by execution ${unicast.execution_id}`
              )
            }
            if (registered === null) {
              this.database.query(
                `INSERT INTO durable_broadcast_signals(
                  signal_id,payload_schema_json,payload_schema_storage_digest,
                  payload_schema_digest,contract_digest,created_at
                ) VALUES(?,?,?,?,?,?)`
              ).run(
                node.signalId,
                schemaJson,
                digest(node.payloadSchema),
                node.payloadSchema.digest,
                node.signalContractDigest,
                now
              )
            } else if (registered.contract_digest !== node.signalContractDigest) {
              throw new SignalDeliveryConflictError(
                `Broadcast signal ${node.signalId} is already pinned to a different payload contract`
              )
            }
          } else if (registered !== null) {
            throw new SignalDeliveryConflictError(
              `Signal identity ${node.signalId} is already pinned as a broadcast identity`
            )
          }
          this.database.query(
            `INSERT INTO durable_signal_contracts(
              execution_id,node_id,signal_id,payload_schema_json,payload_schema_storage_digest,
              payload_schema_digest,contract_digest,delivery
            ) VALUES(?,?,?,?,?,?,?,?)`
          ).run(
            executionId,
            node.id,
            node.signalId,
            schemaJson,
            digest(node.payloadSchema),
            node.payloadSchema.digest,
            node.signalContractDigest,
            broadcast ? "broadcast" : null
          )
        } else if (node.kind === "queue") {
          const schemaJson = canonicalJson(node.itemSchema)
          const registered = this.database.query(
            "SELECT contract_digest FROM durable_queues WHERE queue_id=?"
          ).get(node.queueId) as { readonly contract_digest: string } | null
          if (registered === null) {
            this.database.query(
              `INSERT INTO durable_queues(
                queue_id,item_schema_json,item_schema_storage_digest,
                item_schema_digest,contract_digest,created_at
              ) VALUES(?,?,?,?,?,?)`
            ).run(
              node.queueId,
              schemaJson,
              digest(node.itemSchema),
              node.itemSchema.digest,
              node.queueContractDigest,
              now
            )
          } else if (registered.contract_digest !== node.queueContractDigest) {
            throw new QueueEnqueueConflictError(
              `Durable queue ${node.queueId} is already pinned to a different item contract`
            )
          }
          this.database.query(
            `INSERT INTO durable_queue_contracts(execution_id,node_id,queue_id,contract_digest)
             VALUES(?,?,?,?)`
          ).run(executionId, node.id, node.queueId, node.queueContractDigest)
        }
      }
      this.emit(executionId, null, "execution_started", {
        flowId: validatedPlan.flowId,
        flowVersion: validatedPlan.flowVersion,
        planDigest: validatedPlan.digest,
        manifestDigest: validatedManifest.digest,
        inputDigest
      }, now)
      return this.database.query("SELECT * FROM durable_executions WHERE id = ?").get(executionId) as ExecutionRow
    })
    const row = transaction.immediate()
    return storedExecution(row)
  }

  getExecution(executionId: string): StoredExecution {
    const row = this.database.query("SELECT * FROM durable_executions WHERE id=?").get(executionId) as ExecutionRow | null
    if (row === null) throw new Error(`Unknown durable execution ${executionId}`)
    // Validate pinned input bytes even though callers do not otherwise consume them.
    parseJson(row.input_json, row.input_digest, `execution ${executionId} input`)
    return storedExecution(row)
  }

  /**
   * The digest-verified input the execution was pinned to at initialization.
   * Lets a restarted process re-obtain an execution handle from the execution
   * id and store alone, without re-supplying the original input value.
   */
  getExecutionInput(executionId: string): JsonValue {
    const row = this.database.query(
      "SELECT input_json,input_digest FROM durable_executions WHERE id=?"
    ).get(executionId) as { readonly input_json: string; readonly input_digest: string | null } | null
    if (row === null) throw new Error(`Unknown durable execution ${executionId}`)
    return parseJson(row.input_json, row.input_digest, `execution ${executionId} input`)
  }

  /** Must run inside an open transaction: fences every non-terminal node. */
  private fenceActiveNodes(executionId: string, nodeError: JsonValue, discardReason: string): void {
    const errorJson = canonicalJson(nodeError)
    const errorDigest = digest(nodeError)
    const rows = this.database.query(
      "SELECT * FROM durable_nodes WHERE execution_id=? AND status IN ('pending','running') ORDER BY node_id"
    ).all(executionId) as readonly NodeRow[]
    for (const row of rows) {
      const nodeUpdate = this.database.query(
        `UPDATE durable_nodes SET status='cancelled',error_json=?,error_digest=?,result_json=NULL,
          result_digest=NULL,owner=NULL,lease_until=NULL,retry_at=NULL,wake_at=NULL,signal_waiting_at=NULL,queue_waiting_at=NULL,fence=fence+1,updated_at=?
         WHERE execution_id=? AND node_id=? AND status IN ('pending','running')`
      ).run(errorJson, errorDigest, Date.now(), executionId, row.node_id)
      if (nodeUpdate.changes === 1) {
        if (row.node_kind === "signal") {
          this.discardSignalInbox(executionId, row.node_id, discardReason, Date.now())
        }
        this.emit(executionId, row.node_id, "node_cancelled", { reason: nodeError, fencingToken: row.fence + 1 })
      }
    }
  }

  /**
   * Must run inside an open transaction. Parent termination is recorded before
   * this propagation runs; committing both in one transaction leaves no
   * intermediate state in which a durable parent outcome exists while an
   * attached child execution silently keeps running. Each execution still has
   * exactly one durable winner: a child that already completed or failed
   * keeps its terminal outcome.
   */
  private cancelDescendantExecutions(executionId: string, reason: JsonValue, visited: Set<string>): void {
    const links = this.database.query(
      "SELECT child_execution_id FROM durable_child_executions WHERE parent_execution_id=? ORDER BY node_id"
    ).all(executionId) as readonly { readonly child_execution_id: string }[]
    for (const { child_execution_id: childId } of links) {
      if (visited.has(childId)) continue
      visited.add(childId)
      const executionError = { category: "cancelled", reason }
      const update = this.database.query(
        `UPDATE durable_executions SET status='cancelled',output_json=NULL,output_digest=NULL,
          error_json=?,error_digest=?,updated_at=? WHERE id=? AND status='running'`
      ).run(canonicalJson(executionError), digest(executionError), Date.now(), childId)
      if (update.changes === 1) {
        this.fenceActiveNodes(childId, reason, "parent-execution-terminated")
        this.emit(childId, null, "execution_cancelled", { reason })
      }
      this.cancelDescendantExecutions(childId, reason, visited)
    }
  }

  cancelExecution(executionId: string, reason: JsonValue): FinishExecutionResult {
    const normalizedReason = assertJson(reason, "durable cancellation reason")
    const executionError = { category: "cancelled", reason: normalizedReason }
    const affected = new Set([executionId])
    const transaction = this.database.transaction((): FinishExecutionResult => {
      const update = this.database.query(
        `UPDATE durable_executions SET status='cancelled',output_json=NULL,output_digest=NULL,
          error_json=?,error_digest=?,updated_at=? WHERE id=? AND status='running'`
      ).run(canonicalJson(executionError), digest(executionError), Date.now(), executionId)
      if (update.changes === 1) {
        this.fenceActiveNodes(executionId, normalizedReason, "execution-cancelled")
        this.emit(executionId, null, "execution_cancelled", { reason: normalizedReason })
        this.cancelDescendantExecutions(executionId, normalizedReason, affected)
      }
      const row = this.database.query("SELECT * FROM durable_executions WHERE id=?").get(executionId) as ExecutionRow | null
      if (row === null) throw new Error(`Unknown durable execution ${executionId}`)
      return { changed: update.changes === 1, execution: storedExecution(row) }
    })
    const result = transaction.immediate()
    // Wake suspended coordinators (this execution and every attached
    // descendant) strictly after the fenced COMMIT above.
    for (const id of affected) this.wakeups.notify(id)
    return result
  }

  getNode(executionId: string, nodeId: string): { status: NodeStatus; wakeAt?: number; exit?: StoredNodeExit } {
    const row = this.database.query(
      "SELECT * FROM durable_nodes WHERE execution_id = ? AND node_id = ?"
    ).get(executionId, nodeId) as NodeRow | null
    if (row === null) throw new Error(`Unknown durable node ${executionId}/${nodeId}`)
    const exit = nodeExit(row)
    return {
      status: row.status,
      ...(row.wake_at === null ? {} : { wakeAt: row.wake_at }),
      ...(exit === undefined ? {} : { exit })
    }
  }

  /**
   * Atomically records the complete key -> child identity set before any
   * dynamic Action can run. Repeated calls must reproduce exactly the same
   * canonical keys, child ids, and instantiated input digests.
   */
  materializeFanOut(
    executionId: string,
    fanOutNodeId: string,
    entries: readonly FanOutMaterializationEntry[],
    expectedPlanDigest?: string
  ): FanOutMaterializationResult {
    if (typeof fanOutNodeId !== "string" || fanOutNodeId.trim() === "") {
      throw new TypeError("Durable fan-out node id must be non-empty")
    }
    if (!Array.isArray(entries) || entries.length > 10_000) {
      throw new TypeError("Durable fan-out exceeds the 10,000 item materialization limit")
    }
    const stepped = entries.length > 0 && entries.every((entry) => Object.hasOwn(entry ?? {}, "step"))
    if (!stepped && entries.some((entry) => Object.hasOwn(entry ?? {}, "step"))) {
      throw new TypeError("Durable fan-out materialization cannot mix stepped and legacy child derivations")
    }
    const normalized = entries.map((entry, index) => {
      const key = entry?.key
      if (
        (typeof key !== "string" && typeof key !== "number" && typeof key !== "boolean") ||
        (typeof key === "number" && (!Number.isFinite(key) || Object.is(key, -0)))
      ) {
        throw new TypeError(`Durable fan-out key ${index} must be a canonical string, number, or boolean`)
      }
      if (typeof entry.childNodeId !== "string" || entry.childNodeId.trim() === "") {
        throw new TypeError(`Durable fan-out child id ${index} must be non-empty`)
      }
      if (stepped && entry.step !== 0) {
        throw new TypeError(`Durable fan-out initial materialization ${index} must use step 0`)
      }
      const expectedChildNodeId = stepped
        ? `fan-${digest({ fanOutNodeId, key, step: 0 })}`
        : `fan-${digest({ fanOutNodeId, key })}`
      if (entry.childNodeId !== expectedChildNodeId) {
        throw new TypeError(`Durable fan-out child id ${index} is not derived from its parent and canonical key`)
      }
      if (!/^[0-9a-f]{64}$/.test(entry.inputDigest)) {
        throw new TypeError(`Durable fan-out input digest ${index} is invalid`)
      }
      return {
        key,
        keyJson: canonicalJson(key),
        childNodeId: entry.childNodeId,
        inputDigest: entry.inputDigest
      }
    }).sort((left, right) => left.keyJson < right.keyJson ? -1 : left.keyJson > right.keyJson ? 1 : 0)
    for (let index = 1; index < normalized.length; index++) {
      if (normalized[index - 1]!.keyJson === normalized[index]!.keyJson) {
        throw new TypeError(`Durable fan-out contains duplicate key ${normalized[index]!.keyJson}`)
      }
    }
    if (new Set(normalized.map((entry) => entry.childNodeId)).size !== normalized.length) {
      throw new TypeError("Durable fan-out key derivation produced a child node id collision")
    }
    // Legacy semantics keep their original digest bytes; stepped fan-out
    // includes the step ordinal in both entries and materialization digest.
    const semanticEntries = normalized.map(({ key, childNodeId, inputDigest }) => stepped
      ? { key, childNodeId, inputDigest, step: 0 }
      : { key, childNodeId, inputDigest })
    const materializationDigest = digest({ fanOutNodeId, entries: semanticEntries })

    const transaction = this.database.transaction((): FanOutMaterializationResult => {
      this.assertPinnedPlan(executionId, expectedPlanDigest)
      const parent = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, fanOutNodeId) as NodeRow | null
      if (parent === null) throw new Error(`Unknown durable fan-out node ${executionId}/${fanOutNodeId}`)
      if (parent.node_kind !== "fanout") {
        throw new TypeError(`Durable node ${executionId}/${fanOutNodeId} is not a fan-out`)
      }
      const storedRows = this.database.query(
        `SELECT key_json,child_node_id,input_digest,step FROM durable_fanout_items
         WHERE execution_id=? AND fanout_node_id=? AND step=0`
      ).all(executionId, fanOutNodeId) as readonly {
        readonly key_json: string
        readonly child_node_id: string
        readonly input_digest: string
        readonly step: number
      }[]
      const storedEntries = storedRows.map((row) => {
        const key = decodeCanonicalJson(row.key_json, `fan-out ${executionId}/${fanOutNodeId} key`)
        if (typeof key !== "string" && typeof key !== "number" && typeof key !== "boolean") {
          throw new ContentIntegrityError(`fan-out ${executionId}/${fanOutNodeId} contains a non-scalar persisted key`)
        }
        return stepped
          ? { key, childNodeId: row.child_node_id, inputDigest: row.input_digest, step: 0 }
          : { key, childNodeId: row.child_node_id, inputDigest: row.input_digest }
      }).sort((left, right) => {
        const leftKey = canonicalJson(left.key)
        const rightKey = canonicalJson(right.key)
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
      })

      if (parent.fanout_digest !== null) {
        if (
          parent.fanout_digest !== materializationDigest ||
          canonicalJson(storedEntries) !== canonicalJson(semanticEntries)
        ) {
          throw new ContentIntegrityError(
            `fan-out ${executionId}/${fanOutNodeId} does not match its persisted key materialization`
          )
        }
        for (const entry of semanticEntries) {
          const child = this.database.query(
            "SELECT node_kind FROM durable_nodes WHERE execution_id=? AND node_id=?"
          ).get(executionId, entry.childNodeId) as { readonly node_kind: string | null } | null
          if (child?.node_kind !== "fanout-action") {
            throw new ContentIntegrityError(
              `fan-out ${executionId}/${fanOutNodeId} is missing dynamic child ${entry.childNodeId}`
            )
          }
        }
        return { newlyMaterialized: false, digest: materializationDigest }
      }
      if (storedRows.length > 0) {
        throw new ContentIntegrityError(`fan-out ${executionId}/${fanOutNodeId} has uncommitted materialization rows`)
      }
      if (parent.status !== "pending" && parent.status !== "running") {
        throw new Error(`Durable fan-out ${executionId}/${fanOutNodeId} cannot materialize from ${parent.status}`)
      }
      const now = Date.now()
      for (const entry of normalized) {
        const collision = this.database.query(
          "SELECT node_kind FROM durable_nodes WHERE execution_id=? AND node_id=?"
        ).get(executionId, entry.childNodeId) as { readonly node_kind: string | null } | null
        if (collision !== null) {
          throw new ContentIntegrityError(
            `fan-out ${executionId}/${fanOutNodeId} child identity collides with ${entry.childNodeId}`
          )
        }
        this.database.query(
          `INSERT INTO durable_nodes(execution_id,node_id,node_kind,status,attempt,fence,updated_at)
           VALUES(?,?,?,'pending',0,0,?)`
        ).run(executionId, entry.childNodeId, "fanout-action", now)
        this.database.query(
          `INSERT INTO durable_fanout_items(execution_id,fanout_node_id,key_json,step,child_node_id,input_digest)
           VALUES(?,?,?,0,?,?)`
        ).run(executionId, fanOutNodeId, entry.keyJson, entry.childNodeId, entry.inputDigest)
      }
      const updated = this.database.query(
        `UPDATE durable_nodes SET fanout_digest=?,updated_at=?
         WHERE execution_id=? AND node_id=? AND node_kind='fanout' AND fanout_digest IS NULL
           AND status IN ('pending','running')`
      ).run(materializationDigest, now, executionId, fanOutNodeId)
      if (updated.changes !== 1) {
        throw new Error(`Durable fan-out ${executionId}/${fanOutNodeId} lost its materialization race`)
      }
      this.emit(executionId, fanOutNodeId, "fanout_materialized", {
        materializationDigest,
        entries: semanticEntries
      }, now)
      return { newlyMaterialized: true, digest: materializationDigest }
    })
    return transaction.immediate()
  }

  /**
   * Atomically materializes one later step of a multi-step fan-out template
   * for one committed key. The step's child node row and instantiated input
   * digest commit together before that child can be dispatched, and only after
   * the previous step's child holds a durable success, so a restart cannot
   * silently bind an existing child identity to different work.
   */
  materializeFanOutStep(
    executionId: string,
    fanOutNodeId: string,
    request: FanOutStepMaterializationRequest,
    expectedPlanDigest?: string
  ): FanOutStepMaterializationResult {
    if (typeof fanOutNodeId !== "string" || fanOutNodeId.trim() === "") {
      throw new TypeError("Durable fan-out node id must be non-empty")
    }
    const key = request?.key
    if (
      (typeof key !== "string" && typeof key !== "number" && typeof key !== "boolean") ||
      (typeof key === "number" && (!Number.isFinite(key) || Object.is(key, -0)))
    ) {
      throw new TypeError("Durable fan-out step key must be a canonical string, number, or boolean")
    }
    const step = request.step
    if (!Number.isSafeInteger(step) || step < 1) {
      throw new TypeError("Durable fan-out step ordinal must be a safe integer >= 1")
    }
    const expectedChildNodeId = `fan-${digest({ fanOutNodeId, key, step })}`
    if (request.childNodeId !== expectedChildNodeId) {
      throw new TypeError("Durable fan-out step child id is not derived from its parent, key, and step")
    }
    if (typeof request.inputDigest !== "string" || !/^[0-9a-f]{64}$/.test(request.inputDigest)) {
      throw new TypeError("Durable fan-out step input digest is invalid")
    }
    const keyJson = canonicalJson(key)
    const transaction = this.database.transaction((): FanOutStepMaterializationResult => {
      this.assertPinnedPlan(executionId, expectedPlanDigest)
      const parent = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, fanOutNodeId) as NodeRow | null
      if (parent === null) throw new Error(`Unknown durable fan-out node ${executionId}/${fanOutNodeId}`)
      if (parent.node_kind !== "fanout") {
        throw new TypeError(`Durable node ${executionId}/${fanOutNodeId} is not a fan-out`)
      }
      if (parent.fanout_digest === null) {
        throw new Error(`Durable fan-out ${executionId}/${fanOutNodeId} has no committed key materialization`)
      }
      const initial = this.database.query(
        `SELECT child_node_id,input_digest FROM durable_fanout_items
         WHERE execution_id=? AND fanout_node_id=? AND key_json=? AND step=0`
      ).get(executionId, fanOutNodeId, keyJson) as {
        readonly child_node_id: string
        readonly input_digest: string
      } | null
      if (initial === null) {
        throw new Error(`Durable fan-out ${executionId}/${fanOutNodeId} has no committed key ${keyJson}`)
      }
      if (initial.child_node_id !== `fan-${digest({ fanOutNodeId, key, step: 0 })}`) {
        throw new TypeError(`Durable fan-out ${executionId}/${fanOutNodeId} is not a multi-step template`)
      }
      const existing = this.database.query(
        `SELECT child_node_id,input_digest FROM durable_fanout_items
         WHERE execution_id=? AND fanout_node_id=? AND key_json=? AND step=?`
      ).get(executionId, fanOutNodeId, keyJson, step) as {
        readonly child_node_id: string
        readonly input_digest: string
      } | null
      if (existing !== null) {
        if (existing.child_node_id !== request.childNodeId || existing.input_digest !== request.inputDigest) {
          throw new ContentIntegrityError(
            `fan-out ${executionId}/${fanOutNodeId} step ${step} does not match its persisted materialization for key ${keyJson}`
          )
        }
        const child = this.database.query(
          "SELECT node_kind FROM durable_nodes WHERE execution_id=? AND node_id=?"
        ).get(executionId, request.childNodeId) as { readonly node_kind: string | null } | null
        if (child?.node_kind !== "fanout-action") {
          throw new ContentIntegrityError(
            `fan-out ${executionId}/${fanOutNodeId} is missing dynamic step child ${request.childNodeId}`
          )
        }
        return { newlyMaterialized: false }
      }
      const previous = this.database.query(
        `SELECT child_node_id FROM durable_fanout_items
         WHERE execution_id=? AND fanout_node_id=? AND key_json=? AND step=?`
      ).get(executionId, fanOutNodeId, keyJson, step - 1) as { readonly child_node_id: string } | null
      if (previous === null) {
        throw new Error(
          `Durable fan-out ${executionId}/${fanOutNodeId} step ${step} has no committed predecessor for key ${keyJson}`
        )
      }
      const previousChild = this.database.query(
        "SELECT status FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, previous.child_node_id) as { readonly status: NodeStatus } | null
      if (previousChild?.status !== "succeeded") {
        throw new Error(
          `Durable fan-out ${executionId}/${fanOutNodeId} step ${step} requires a durable step ${step - 1} success for key ${keyJson}`
        )
      }
      if (parent.status !== "pending" && parent.status !== "running") {
        throw new Error(`Durable fan-out ${executionId}/${fanOutNodeId} cannot extend from ${parent.status}`)
      }
      const collision = this.database.query(
        "SELECT node_kind FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, request.childNodeId) as { readonly node_kind: string | null } | null
      if (collision !== null) {
        throw new ContentIntegrityError(
          `fan-out ${executionId}/${fanOutNodeId} step child identity collides with ${request.childNodeId}`
        )
      }
      const now = Date.now()
      this.database.query(
        `INSERT INTO durable_nodes(execution_id,node_id,node_kind,status,attempt,fence,updated_at)
         VALUES(?,?,?,'pending',0,0,?)`
      ).run(executionId, request.childNodeId, "fanout-action", now)
      this.database.query(
        `INSERT INTO durable_fanout_items(execution_id,fanout_node_id,key_json,step,child_node_id,input_digest)
         VALUES(?,?,?,?,?,?)`
      ).run(executionId, fanOutNodeId, keyJson, step, request.childNodeId, request.inputDigest)
      this.emit(executionId, fanOutNodeId, "fanout_step_materialized", {
        key,
        step,
        childNodeId: request.childNodeId,
        inputDigest: request.inputDigest
      }, now)
      return { newlyMaterialized: true }
    })
    return transaction.immediate()
  }

  /**
   * Atomically commits one loop round's identity — child node, instantiated
   * input digest, and originating state digest — before that round's Action
   * can be dispatched, and only after the previous round's child holds a
   * durable success. Replay must reproduce exactly the same round evidence,
   * so a restart cannot bind an existing round child to different work.
   */
  materializeLoopRound(
    executionId: string,
    loopNodeId: string,
    request: LoopRoundMaterializationRequest,
    expectedPlanDigest?: string
  ): LoopRoundMaterializationResult {
    if (typeof loopNodeId !== "string" || loopNodeId.trim() === "") {
      throw new TypeError("Durable loop node id must be non-empty")
    }
    const round = request?.round
    if (!Number.isSafeInteger(round) || round < 0) {
      throw new TypeError("Durable loop round ordinal must be a non-negative safe integer")
    }
    const expectedChildNodeId = `loop-${digest({ loopNodeId, round })}`
    if (request.childNodeId !== expectedChildNodeId) {
      throw new TypeError("Durable loop round child id is not derived from its loop node and round ordinal")
    }
    if (typeof request.inputDigest !== "string" || !/^[0-9a-f]{64}$/.test(request.inputDigest)) {
      throw new TypeError("Durable loop round input digest is invalid")
    }
    if (typeof request.stateDigest !== "string" || !/^[0-9a-f]{64}$/.test(request.stateDigest)) {
      throw new TypeError("Durable loop round state digest is invalid")
    }
    const transaction = this.database.transaction((): LoopRoundMaterializationResult => {
      this.assertPinnedPlan(executionId, expectedPlanDigest)
      const parent = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, loopNodeId) as NodeRow | null
      if (parent === null) throw new Error(`Unknown durable loop node ${executionId}/${loopNodeId}`)
      if (parent.node_kind !== "loop") {
        throw new TypeError(`Durable node ${executionId}/${loopNodeId} is not a loop`)
      }
      const existing = this.database.query(
        `SELECT child_node_id,input_digest,state_digest FROM durable_loop_rounds
         WHERE execution_id=? AND loop_node_id=? AND round=?`
      ).get(executionId, loopNodeId, round) as {
        readonly child_node_id: string
        readonly input_digest: string
        readonly state_digest: string
      } | null
      if (existing !== null) {
        if (
          existing.child_node_id !== request.childNodeId ||
          existing.input_digest !== request.inputDigest ||
          existing.state_digest !== request.stateDigest
        ) {
          throw new ContentIntegrityError(
            `loop ${executionId}/${loopNodeId} round ${round} does not match its persisted materialization`
          )
        }
        const child = this.database.query(
          "SELECT node_kind FROM durable_nodes WHERE execution_id=? AND node_id=?"
        ).get(executionId, request.childNodeId) as { readonly node_kind: string | null } | null
        if (child?.node_kind !== "loop-action") {
          throw new ContentIntegrityError(
            `loop ${executionId}/${loopNodeId} is missing round child ${request.childNodeId}`
          )
        }
        return { newlyMaterialized: false }
      }
      if (round > 0) {
        const previous = this.database.query(
          `SELECT child_node_id FROM durable_loop_rounds
           WHERE execution_id=? AND loop_node_id=? AND round=?`
        ).get(executionId, loopNodeId, round - 1) as { readonly child_node_id: string } | null
        if (previous === null) {
          throw new Error(
            `Durable loop ${executionId}/${loopNodeId} round ${round} has no committed predecessor round`
          )
        }
        const previousChild = this.database.query(
          "SELECT status FROM durable_nodes WHERE execution_id=? AND node_id=?"
        ).get(executionId, previous.child_node_id) as { readonly status: NodeStatus } | null
        if (previousChild?.status !== "succeeded") {
          throw new Error(
            `Durable loop ${executionId}/${loopNodeId} round ${round} requires a durable round ${round - 1} success`
          )
        }
      }
      if (parent.status !== "pending" && parent.status !== "running") {
        throw new Error(`Durable loop ${executionId}/${loopNodeId} cannot extend from ${parent.status}`)
      }
      const collision = this.database.query(
        "SELECT node_kind FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, request.childNodeId) as { readonly node_kind: string | null } | null
      if (collision !== null) {
        throw new ContentIntegrityError(
          `loop ${executionId}/${loopNodeId} round child identity collides with ${request.childNodeId}`
        )
      }
      const now = Date.now()
      this.database.query(
        `INSERT INTO durable_nodes(execution_id,node_id,node_kind,status,attempt,fence,updated_at)
         VALUES(?,?,?,'pending',0,0,?)`
      ).run(executionId, request.childNodeId, "loop-action", now)
      this.database.query(
        `INSERT INTO durable_loop_rounds(execution_id,loop_node_id,round,child_node_id,input_digest,state_digest)
         VALUES(?,?,?,?,?,?)`
      ).run(executionId, loopNodeId, round, request.childNodeId, request.inputDigest, request.stateDigest)
      this.emit(executionId, loopNodeId, "loop_round_materialized", {
        round,
        childNodeId: request.childNodeId,
        inputDigest: request.inputDigest,
        stateDigest: request.stateDigest
      }, now)
      return { newlyMaterialized: true }
    })
    return transaction.immediate()
  }

  /**
   * Durably links one childFlow node to its deterministic child execution id
   * before the child execution is created. Repeated linkage is idempotent;
   * a different child identity or Plan digest for the same node fails closed.
   */
  registerChildExecution(
    parentExecutionId: string,
    nodeId: string,
    childExecutionId: string,
    planDigest: string,
    expectedParentPlanDigest?: string
  ): ChildExecutionLinkResult {
    for (const [label, value] of [
      ["parent execution id", parentExecutionId],
      ["node id", nodeId],
      ["child execution id", childExecutionId]
    ] as const) {
      if (
        typeof value !== "string" || value.trim() === "" || value.includes("\0") ||
        new TextEncoder().encode(value).byteLength > 512
      ) {
        throw new TypeError(`Durable child ${label} must be a bounded non-empty string`)
      }
    }
    if (typeof planDigest !== "string" || !/^[0-9a-f]{64}$/.test(planDigest)) {
      throw new TypeError("Durable child execution plan digest is invalid")
    }
    if (childExecutionId === parentExecutionId) {
      throw new TypeError("Durable child execution id cannot equal its parent execution id")
    }
    const transaction = this.database.transaction((): ChildExecutionLinkResult => {
      this.assertPinnedPlan(parentExecutionId, expectedParentPlanDigest)
      const parent = this.database.query(
        "SELECT status FROM durable_executions WHERE id=?"
      ).get(parentExecutionId) as { readonly status: ExecutionStatus } | null
      if (parent === null) throw new Error(`Unknown durable execution ${parentExecutionId}`)
      const node = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(parentExecutionId, nodeId) as NodeRow | null
      if (node === null || node.node_kind !== "childFlow") {
        throw new TypeError(`Unknown durable childFlow node ${parentExecutionId}/${nodeId}`)
      }
      const existing = this.database.query(
        "SELECT child_execution_id,plan_digest FROM durable_child_executions WHERE parent_execution_id=? AND node_id=?"
      ).get(parentExecutionId, nodeId) as {
        readonly child_execution_id: string
        readonly plan_digest: string
      } | null
      const link: ChildExecutionLink = { nodeId, childExecutionId, planDigest }
      if (existing !== null) {
        if (existing.child_execution_id !== childExecutionId || existing.plan_digest !== planDigest) {
          throw new ContentIntegrityError(
            `childFlow ${parentExecutionId}/${nodeId} is already linked to a different child execution or Plan`
          )
        }
        return { newlyLinked: false, link }
      }
      if (parent.status !== "running" || (node.status !== "pending" && node.status !== "running")) {
        throw new Error(
          `Durable childFlow ${parentExecutionId}/${nodeId} cannot link a child in ${parent.status}/${node.status}`
        )
      }
      const now = Date.now()
      this.database.query(
        `INSERT INTO durable_child_executions(parent_execution_id,node_id,child_execution_id,plan_digest,created_at)
         VALUES(?,?,?,?,?)`
      ).run(parentExecutionId, nodeId, childExecutionId, planDigest, now)
      this.emit(parentExecutionId, nodeId, "child_flow_linked", {
        childExecutionId,
        planDigest
      }, now)
      return { newlyLinked: true, link }
    })
    return transaction.immediate()
  }

  /** Direct child execution links recorded for one parent execution. */
  listChildExecutions(executionId: string): readonly ChildExecutionLink[] {
    const rows = this.database.query(
      `SELECT node_id,child_execution_id,plan_digest FROM durable_child_executions
       WHERE parent_execution_id=? ORDER BY node_id`
    ).all(executionId) as readonly {
      readonly node_id: string
      readonly child_execution_id: string
      readonly plan_digest: string
    }[]
    return rows.map((row) => ({
      nodeId: row.node_id,
      childExecutionId: row.child_execution_id,
      planDigest: row.plan_digest
    }))
  }

  /**
   * Persist one external signal delivery and its journal evidence atomically.
   * The schema comes only from execution initialization; callers supply no
   * type authority. One node accepts one idempotency key/payload pair.
   * Delivery is fail-closed on sender authorization: the default requires a
   * minted token bound to (executionId, signalId); the legacy tokenless path
   * exists only behind an explicit `unsafeLocalDelivery: true`.
   */
  deliverSignal(
    untrustedRequest: SignalDeliveryRequest,
    untrustedExpectation: SignalContractExpectation,
    authorization: SignalDeliveryAuthorization = {}
  ): SignalDeliveryResult {
    const normalizedRequest = assertJson(untrustedRequest, "durable signal delivery request")
    if (
      normalizedRequest === null || Array.isArray(normalizedRequest) || typeof normalizedRequest !== "object" ||
      canonicalJson(Object.keys(normalizedRequest).sort()) !== canonicalJson([
        "executionId", "idempotencyKey", "nodeId", "payload", "signalId"
      ])
    ) throw new TypeError("Durable signal delivery request must have exact fields")
    const request = normalizedRequest as unknown as SignalDeliveryRequest
    const normalizedExpectation = assertJson(untrustedExpectation, "durable signal contract expectation")
    if (
      normalizedExpectation === null || Array.isArray(normalizedExpectation) || typeof normalizedExpectation !== "object" ||
      canonicalJson(Object.keys(normalizedExpectation).sort()) !== canonicalJson([
        "planDigest", "signalContractDigest", "signalId"
      ]) ||
      typeof normalizedExpectation.planDigest !== "string" || !/^[0-9a-f]{64}$/.test(normalizedExpectation.planDigest) ||
      typeof normalizedExpectation.signalContractDigest !== "string" || !/^[0-9a-f]{64}$/.test(normalizedExpectation.signalContractDigest) ||
      typeof normalizedExpectation.signalId !== "string"
    ) throw new TypeError("Durable signal contract expectation is invalid")
    const expectation = normalizedExpectation as unknown as SignalContractExpectation
    for (const [label, value, limit] of [
      ["execution id", request.executionId, 512],
      ["node id", request.nodeId, 512],
      ["signal id", request.signalId, 128],
      ["idempotency key", request.idempotencyKey, 512]
    ] as const) {
      if (
        typeof value !== "string" || value.trim() === "" ||
        new TextEncoder().encode(value).byteLength > limit || value.includes("\0")
      ) {
        throw new TypeError(`Durable signal ${label} must be a bounded non-empty string`)
      }
    }
    // Authorization is enforced before any execution row is read, so a sender
    // without evidence learns nothing about execution existence or state.
    this.authorizeSignalDelivery(request, authorization)
    const transaction = this.database.transaction((): SignalDeliveryResult => {
      const now = Date.now()
      const execution = this.database.query(
        "SELECT status,deadline,plan_digest FROM durable_executions WHERE id=?"
      ).get(request.executionId) as {
        readonly status: ExecutionStatus
        readonly deadline: number
        readonly plan_digest: string
      } | null
      if (execution === null) {
        throw new SignalDeliveryRejectedError(`Unknown durable execution ${request.executionId}`)
      }
      const node = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(request.executionId, request.nodeId) as NodeRow | null
      if (node === null || node.node_kind !== "signal") {
        throw new SignalDeliveryRejectedError(
          `Unknown durable signal node ${request.executionId}/${request.nodeId}`
        )
      }
      const { row: contract, schema } = this.signalContract(request.executionId, request.nodeId)
      if (execution.plan_digest !== expectation.planDigest || expectation.signalId !== request.signalId) {
        throw new SignalDeliveryRejectedError(
          `Signal Plan contract does not match ${request.executionId}/${request.nodeId}`
        )
      }
      if (
        contract.contract_digest !== expectation.signalContractDigest ||
        contract.signal_id !== expectation.signalId
      ) {
        throw new ContentIntegrityError(
          `signal ${request.executionId}/${request.nodeId} disagrees with the coordinator Plan contract`
        )
      }
      let payload: JsonValue
      try {
        payload = validateDurableValue(schema, request.payload, `signal ${request.signalId} payload`)
      } catch (error) {
        throw new SignalDeliveryRejectedError(
          `Signal ${request.signalId} payload was rejected: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      const payloadDigest = digest(payload)
      const existing = this.database.query(
        "SELECT * FROM durable_signal_inbox WHERE execution_id=? AND node_id=?"
      ).get(request.executionId, request.nodeId) as SignalInboxRow | null
      if (existing !== null) {
        const validated = this.signalInbox(contract, existing)
        if (
          existing.signal_id === request.signalId &&
          existing.idempotency_key === request.idempotencyKey &&
          existing.payload_digest === payloadDigest &&
          canonicalJson(validated.payload) === canonicalJson(payload)
        ) return validated.result
        throw new SignalDeliveryConflictError(
          `Signal ${request.executionId}/${request.nodeId} already has a different key or payload`
        )
      }
      if (execution.status !== "running" || node.status !== "pending") {
        throw new SignalDeliveryRejectedError(
          `Signal ${request.executionId}/${request.nodeId} cannot be delivered in ${execution.status}/${node.status}`
        )
      }
      if (now >= execution.deadline) {
        throw new SignalDeliveryRejectedError(
          `Signal ${request.executionId}/${request.nodeId} arrived after the persisted execution deadline`
        )
      }
      if (
        node.owner !== null || node.lease_until !== null || node.retry_at !== null ||
        node.wake_at !== null || node.attempt !== 0
      ) {
        throw new ContentIntegrityError(
          `signal ${request.executionId}/${request.nodeId} incorrectly holds worker scheduling state`
        )
      }
      const payloadJson = canonicalJson(payload)
      const deliveryDigest = digest({
        formatVersion: 1,
        executionId: request.executionId,
        nodeId: request.nodeId,
        signalId: request.signalId,
        idempotencyKey: request.idempotencyKey,
        payloadDigest,
        schemaDigest: contract.payload_schema_digest,
        deliveredAt: now
      })
      this.database.query(
        `INSERT INTO durable_signal_inbox(
          execution_id,node_id,signal_id,idempotency_key,payload_json,payload_digest,
          schema_digest,delivery_digest,state,delivered_at,consumed_at,discarded_at
        ) VALUES(?,?,?,?,?,?,?,?,'pending',?,NULL,NULL)`
      ).run(
        request.executionId,
        request.nodeId,
        request.signalId,
        request.idempotencyKey,
        payloadJson,
        payloadDigest,
        contract.payload_schema_digest,
        deliveryDigest,
        now
      )
      this.emit(request.executionId, request.nodeId, "signal_delivered", {
        signalId: request.signalId,
        idempotencyKey: request.idempotencyKey,
        payloadDigest,
        schemaDigest: contract.payload_schema_digest,
        deliveryDigest
      }, now)
      return { duplicate: false, state: "pending", payloadDigest, deliveryDigest }
    })
    const result = transaction.immediate()
    // The wakeup is strictly after COMMIT: a woken coordinator re-reading the
    // inbox observes the delivery. Missed notifications (other connections,
    // other processes) are covered by the coordinator's fallback sweep.
    this.wakeups.notify(request.executionId)
    return result
  }

  /**
   * Poll/consume a signal without acquiring a worker lease. Inbox state, node
   * success, and journal evidence transition in one SQLite transaction.
   */
  pollSignal(
    executionId: string,
    nodeId: string,
    untrustedExpectation: SignalContractExpectation
  ): SignalPollResult {
    const normalizedExpectation = assertJson(untrustedExpectation, "durable signal contract expectation")
    if (
      normalizedExpectation === null || Array.isArray(normalizedExpectation) || typeof normalizedExpectation !== "object" ||
      canonicalJson(Object.keys(normalizedExpectation).sort()) !== canonicalJson([
        "planDigest", "signalContractDigest", "signalId"
      ]) ||
      typeof normalizedExpectation.planDigest !== "string" || !/^[0-9a-f]{64}$/.test(normalizedExpectation.planDigest) ||
      typeof normalizedExpectation.signalContractDigest !== "string" || !/^[0-9a-f]{64}$/.test(normalizedExpectation.signalContractDigest) ||
      typeof normalizedExpectation.signalId !== "string"
    ) throw new TypeError("Durable signal contract expectation is invalid")
    const expectation = normalizedExpectation as unknown as SignalContractExpectation
    const transaction = this.database.transaction((): SignalPollResult => {
      const node = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, nodeId) as NodeRow | null
      if (node === null || node.node_kind !== "signal") {
        throw new TypeError(`Unknown durable signal node ${executionId}/${nodeId}`)
      }
      const { row: contract, broadcast } = this.signalContract(executionId, nodeId)
      const execution = this.database.query(
        "SELECT plan_digest,plan_generation FROM durable_executions WHERE id=?"
      ).get(executionId) as { readonly plan_digest: string; readonly plan_generation: number } | null
      if (execution === null) throw new Error(`Unknown durable execution ${executionId}`)
      if (execution.plan_digest !== expectation.planDigest) {
        throw new ExecutionMigratedError(
          executionId,
          expectation.planDigest,
          execution.plan_digest,
          execution.plan_generation
        )
      }
      if (
        contract.contract_digest !== expectation.signalContractDigest ||
        contract.signal_id !== expectation.signalId
      ) {
        throw new ContentIntegrityError(`signal ${executionId}/${nodeId} disagrees with the coordinator Plan`)
      }
      if (broadcast) return this.pollBroadcastSignal(executionId, nodeId, node, contract)
      const inbox = this.database.query(
        "SELECT * FROM durable_signal_inbox WHERE execution_id=? AND node_id=?"
      ).get(executionId, nodeId) as SignalInboxRow | null
      const terminal = nodeExit(node)
      if (terminal !== undefined) {
        if (inbox !== null) {
          const validated = this.signalInbox(contract, inbox)
          if (terminal.kind === "success") {
            if (
              inbox.state !== "consumed" ||
              canonicalJson(terminal.value) !== canonicalJson(validated.payload)
            ) {
              throw new ContentIntegrityError(`signal ${executionId}/${nodeId} terminal value disagrees with its inbox`)
            }
          } else if (inbox.state !== "discarded") {
            throw new ContentIntegrityError(`signal ${executionId}/${nodeId} terminal state did not discard its inbox`)
          }
        } else if (terminal.kind === "success") {
          throw new ContentIntegrityError(`signal ${executionId}/${nodeId} succeeded without a persisted delivery`)
        }
        return { kind: "terminal", exit: terminal, newlyConsumed: false }
      }
      if (
        node.status !== "pending" || node.owner !== null || node.lease_until !== null ||
        node.retry_at !== null || node.wake_at !== null || node.attempt !== 0
      ) {
        throw new ContentIntegrityError(`signal ${executionId}/${nodeId} has invalid suspended scheduling state`)
      }
      if (inbox !== null) {
        const { payload } = this.signalInbox(contract, inbox)
        if (inbox.state !== "pending") {
          throw new ContentIntegrityError(`signal ${executionId}/${nodeId} has a non-terminal ${inbox.state} inbox`)
        }
        const now = Date.now()
        const payloadJson = canonicalJson(payload)
        const payloadDigest = digest(payload)
        const consumed = this.database.query(
          `UPDATE durable_signal_inbox SET state='consumed',consumed_at=?
           WHERE execution_id=? AND node_id=? AND state='pending'`
        ).run(now, executionId, nodeId)
        const succeeded = this.database.query(
          `UPDATE durable_nodes SET status='succeeded',result_json=?,result_digest=?,error_json=NULL,
            error_digest=NULL,signal_waiting_at=NULL,updated_at=?
           WHERE execution_id=? AND node_id=? AND node_kind='signal' AND status='pending'
             AND owner IS NULL AND lease_until IS NULL AND retry_at IS NULL AND wake_at IS NULL AND attempt=0`
        ).run(payloadJson, payloadDigest, now, executionId, nodeId)
        if (consumed.changes !== 1 || succeeded.changes !== 1) {
          throw new Error(`Durable signal ${executionId}/${nodeId} lost its atomic consume race`)
        }
        this.emit(executionId, nodeId, "signal_consumed", {
          signalId: inbox.signal_id,
          idempotencyKey: inbox.idempotency_key,
          payloadDigest,
          deliveryDigest: inbox.delivery_digest
        }, now)
        this.emit(executionId, nodeId, "node_succeeded", {
          attempt: 0,
          fencingToken: node.fence,
          resultDigest: payloadDigest,
          adoptedFrom: null,
          coordinatorOwned: "signal"
        }, now)
        return {
          kind: "terminal",
          exit: { kind: "success", value: payload, adoptedFrom: null },
          newlyConsumed: true
        }
      }
      const now = Date.now()
      const update = this.database.query(
        `UPDATE durable_nodes SET signal_waiting_at=?,updated_at=?
         WHERE execution_id=? AND node_id=? AND node_kind='signal' AND status='pending'
           AND signal_waiting_at IS NULL AND owner IS NULL AND lease_until IS NULL AND attempt=0`
      ).run(now, now, executionId, nodeId)
      if (update.changes === 1) {
        this.emit(executionId, nodeId, "signal_waiting", {
          signalId: contract.signal_id,
          schemaDigest: contract.payload_schema_digest
        }, now)
      }
      return { kind: "waiting", newlyWaiting: update.changes === 1 }
    })
    return transaction.immediate()
  }

  /**
   * The broadcast half of `pollSignal`. Must run inside the caller's open
   * transaction, which has already checked node kind, pinned Plan digest, and
   * the coordinator's signal contract.
   *
   * A waiter's FIRST poll commits a durable subscription watermark: the highest
   * delivery sequence that existed at that instant. The node is then entitled
   * to exactly the deliveries committed strictly after it, so one delivery
   * satisfies every already-subscribed waiter and a late execution never
   * retro-consumes an old broadcast. Consumption is one per (execution, node),
   * committed in the same transaction as the node's terminal success.
   */
  private pollBroadcastSignal(
    executionId: string,
    nodeId: string,
    node: NodeRow,
    contract: SignalContractRow
  ): SignalPollResult {
    const consumption = this.database.query(
      "SELECT * FROM durable_broadcast_consumptions WHERE execution_id=? AND node_id=?"
    ).get(executionId, nodeId) as {
      readonly signal_id: string
      readonly sequence: number
      readonly payload_digest: string
      readonly delivery_digest: string
    } | null
    const terminal = nodeExit(node)
    if (terminal !== undefined) {
      if (terminal.kind === "success") {
        // The consumption row is self-sufficient evidence: it carries the
        // payload digest, so retention GC of the delivery row cannot weaken
        // this re-verification.
        if (
          consumption === null || consumption.signal_id !== contract.signal_id ||
          consumption.payload_digest !== node.result_digest ||
          digest(terminal.value) !== consumption.payload_digest
        ) {
          throw new ContentIntegrityError(
            `broadcast signal ${executionId}/${nodeId} terminal value disagrees with its consumption record`
          )
        }
      } else if (consumption !== null) {
        throw new ContentIntegrityError(
          `broadcast signal ${executionId}/${nodeId} has a consumption record under a non-success exit`
        )
      }
      return { kind: "terminal", exit: terminal, newlyConsumed: false }
    }
    if (consumption !== null) {
      throw new ContentIntegrityError(
        `broadcast signal ${executionId}/${nodeId} consumed a delivery without a terminal node exit`
      )
    }
    if (
      node.status !== "pending" || node.owner !== null || node.lease_until !== null ||
      node.retry_at !== null || node.wake_at !== null || node.attempt !== 0
    ) {
      throw new ContentIntegrityError(
        `broadcast signal ${executionId}/${nodeId} has invalid suspended scheduling state`
      )
    }
    const now = Date.now()
    const subscription = this.database.query(
      "SELECT signal_id,watermark FROM durable_broadcast_subscriptions WHERE execution_id=? AND node_id=?"
    ).get(executionId, nodeId) as { readonly signal_id: string; readonly watermark: number } | null
    if (subscription === null) {
      const head = this.database.query(
        "SELECT COALESCE(MAX(sequence),0) AS watermark FROM durable_broadcast_deliveries WHERE signal_id=?"
      ).get(contract.signal_id) as { readonly watermark: number }
      this.database.query(
        `INSERT INTO durable_broadcast_subscriptions(execution_id,node_id,signal_id,watermark,subscribed_at)
         VALUES(?,?,?,?,?)`
      ).run(executionId, nodeId, contract.signal_id, head.watermark, now)
      const update = this.database.query(
        `UPDATE durable_nodes SET signal_waiting_at=?,updated_at=?
         WHERE execution_id=? AND node_id=? AND node_kind='signal' AND status='pending'
           AND signal_waiting_at IS NULL AND owner IS NULL AND lease_until IS NULL AND attempt=0`
      ).run(now, now, executionId, nodeId)
      if (update.changes !== 1) {
        throw new Error(`Durable broadcast signal ${executionId}/${nodeId} lost its subscription race`)
      }
      this.emit(executionId, nodeId, "broadcast_subscribed", {
        signalId: contract.signal_id,
        schemaDigest: contract.payload_schema_digest,
        watermark: head.watermark
      }, now)
      return { kind: "waiting", newlyWaiting: true }
    }
    if (subscription.signal_id !== contract.signal_id || node.signal_waiting_at === null) {
      throw new ContentIntegrityError(
        `broadcast signal ${executionId}/${nodeId} subscription disagrees with its pinned contract`
      )
    }
    const delivery = this.database.query(
      `SELECT * FROM durable_broadcast_deliveries
       WHERE signal_id=? AND sequence>? ORDER BY sequence LIMIT 1`
    ).get(contract.signal_id, subscription.watermark) as {
      readonly sequence: number
      readonly signal_id: string
      readonly idempotency_key: string
      readonly payload_json: string
      readonly payload_digest: string
      readonly schema_digest: string
      readonly delivery_digest: string
      readonly delivered_at: number
    } | null
    if (delivery === null) return { kind: "waiting", newlyWaiting: false }
    if (delivery.schema_digest !== contract.payload_schema_digest) {
      throw new ContentIntegrityError(
        `broadcast ${contract.signal_id} delivery ${delivery.sequence} was stored under a different payload schema`
      )
    }
    const label = `broadcast ${contract.signal_id} delivery ${delivery.sequence}`
    const payload = parseJson(delivery.payload_json, delivery.payload_digest, `${label} payload`)
    const expectedDeliveryDigest = digest({
      formatVersion: 1,
      broadcast: true,
      sequence: delivery.sequence,
      signalId: delivery.signal_id,
      idempotencyKey: delivery.idempotency_key,
      payloadDigest: delivery.payload_digest,
      schemaDigest: delivery.schema_digest,
      deliveredAt: delivery.delivered_at
    })
    if (delivery.delivery_digest !== expectedDeliveryDigest) {
      throw new ContentIntegrityError(`${label} digest mismatch`)
    }
    const { schema } = this.signalContract(executionId, nodeId)
    try {
      validateDurableValue(schema, payload, `${label} payload`)
    } catch (error) {
      throw new ContentIntegrityError(
        `${label} violates its persisted schema: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    this.database.query(
      `INSERT INTO durable_broadcast_consumptions(
        execution_id,node_id,signal_id,sequence,idempotency_key,payload_digest,delivery_digest,consumed_at
      ) VALUES(?,?,?,?,?,?,?,?)`
    ).run(
      executionId,
      nodeId,
      delivery.signal_id,
      delivery.sequence,
      delivery.idempotency_key,
      delivery.payload_digest,
      delivery.delivery_digest,
      now
    )
    const succeeded = this.database.query(
      `UPDATE durable_nodes SET status='succeeded',result_json=?,result_digest=?,error_json=NULL,
        error_digest=NULL,signal_waiting_at=NULL,updated_at=?
       WHERE execution_id=? AND node_id=? AND node_kind='signal' AND status='pending'
         AND owner IS NULL AND lease_until IS NULL AND retry_at IS NULL AND wake_at IS NULL AND attempt=0`
    ).run(canonicalJson(payload), delivery.payload_digest, now, executionId, nodeId)
    if (succeeded.changes !== 1) {
      throw new Error(`Durable broadcast signal ${executionId}/${nodeId} lost its atomic consume race`)
    }
    this.emit(executionId, nodeId, "broadcast_consumed", {
      signalId: delivery.signal_id,
      sequence: delivery.sequence,
      idempotencyKey: delivery.idempotency_key,
      payloadDigest: delivery.payload_digest,
      deliveryDigest: delivery.delivery_digest,
      watermark: subscription.watermark
    }, now)
    this.emit(executionId, nodeId, "node_succeeded", {
      attempt: 0,
      fencingToken: node.fence,
      resultDigest: delivery.payload_digest,
      adoptedFrom: null,
      coordinatorOwned: "broadcast"
    }, now)
    return {
      kind: "terminal",
      exit: { kind: "success", value: payload, adoptedFrom: null },
      newlyConsumed: true
    }
  }

  /**
   * Commits one broadcast delivery. Unlike a unicast delivery this addresses a
   * signal IDENTITY, not one (execution, node) inbox: every execution already
   * subscribed to that identity becomes entitled to it, and each consumes it
   * exactly once through its own consumption record. Idempotency is by
   * (signalId, idempotencyKey); the payload schema comes only from the pinned
   * broadcast registry, never from the sender.
   */
  deliverBroadcast(
    untrustedRequest: BroadcastDeliveryRequest,
    untrustedExpectation: BroadcastContractExpectation,
    authorization: SignalDeliveryAuthorization = {}
  ): BroadcastDeliveryResult {
    const normalizedRequest = assertJson(untrustedRequest, "durable broadcast delivery request")
    if (
      normalizedRequest === null || Array.isArray(normalizedRequest) || typeof normalizedRequest !== "object" ||
      canonicalJson(Object.keys(normalizedRequest).sort()) !== canonicalJson([
        "idempotencyKey", "payload", "signalId"
      ])
    ) throw new TypeError("Durable broadcast delivery request must have exact fields")
    const request = normalizedRequest as unknown as BroadcastDeliveryRequest
    const normalizedExpectation = assertJson(untrustedExpectation, "durable broadcast contract expectation")
    if (
      normalizedExpectation === null || Array.isArray(normalizedExpectation) || typeof normalizedExpectation !== "object" ||
      canonicalJson(Object.keys(normalizedExpectation).sort()) !== canonicalJson([
        "signalContractDigest", "signalId"
      ]) ||
      typeof normalizedExpectation.signalContractDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(normalizedExpectation.signalContractDigest) ||
      typeof normalizedExpectation.signalId !== "string"
    ) throw new TypeError("Durable broadcast contract expectation is invalid")
    const expectation = normalizedExpectation as unknown as BroadcastContractExpectation
    assertBoundedIdentity("signal id", request.signalId, 128)
    assertBoundedIdentity("idempotency key", request.idempotencyKey, 512)
    // Authorization precedes every read, so an unauthorized sender learns
    // nothing about which broadcast identities exist.
    this.authorizeOpaqueToken(
      authorization,
      "senderToken",
      "broadcast delivery",
      () => this.computeBroadcastToken(request.signalId),
      "Durable broadcast delivery requires a minted sender token or explicit unsafeLocalDelivery",
      `Sender token does not authorize broadcast signal ${request.signalId}`,
      SignalDeliveryUnauthorizedError
    )
    const transaction = this.database.transaction((): BroadcastDeliveryResult => {
      const now = Date.now()
      const registry = this.broadcastRegistry(request.signalId)
      if (
        registry.contractDigest !== expectation.signalContractDigest ||
        expectation.signalId !== request.signalId
      ) {
        throw new SignalDeliveryRejectedError(
          `Broadcast contract does not match the pinned registry for signal ${request.signalId}`
        )
      }
      let payload: JsonValue
      try {
        payload = validateDurableValue(registry.schema, request.payload, `broadcast ${request.signalId} payload`)
      } catch (error) {
        throw new SignalDeliveryRejectedError(
          `Broadcast ${request.signalId} payload was rejected: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      const payloadDigest = digest(payload)
      const existing = this.database.query(
        "SELECT * FROM durable_broadcast_deliveries WHERE signal_id=? AND idempotency_key=?"
      ).get(request.signalId, request.idempotencyKey) as {
        readonly sequence: number
        readonly payload_digest: string
        readonly delivery_digest: string
      } | null
      if (existing !== null) {
        if (existing.payload_digest !== payloadDigest) {
          throw new SignalDeliveryConflictError(
            `Broadcast ${request.signalId} already delivered a different payload under key ${request.idempotencyKey}`
          )
        }
        return {
          duplicate: true,
          sequence: existing.sequence,
          payloadDigest,
          deliveryDigest: existing.delivery_digest,
          notifiedExecutions: []
        }
      }
      const inserted = this.database.query(
        `INSERT INTO durable_broadcast_deliveries(
          signal_id,idempotency_key,payload_json,payload_digest,schema_digest,delivery_digest,delivered_at
        ) VALUES(?,?,?,?,?,'',?)`
      ).run(
        request.signalId,
        request.idempotencyKey,
        canonicalJson(payload),
        payloadDigest,
        registry.schemaDigest,
        now
      )
      const sequence = Number(inserted.lastInsertRowid)
      const deliveryDigest = digest({
        formatVersion: 1,
        broadcast: true,
        sequence,
        signalId: request.signalId,
        idempotencyKey: request.idempotencyKey,
        payloadDigest,
        schemaDigest: registry.schemaDigest,
        deliveredAt: now
      })
      this.database.query("UPDATE durable_broadcast_deliveries SET delivery_digest=? WHERE sequence=?")
        .run(deliveryDigest, sequence)
      // Exactly the still-waiting subscribers entitled to this delivery. The
      // list is bounded; anything beyond it converges through the sweep.
      const waiters = this.database.query(
        `SELECT DISTINCT s.execution_id AS execution_id
         FROM durable_broadcast_subscriptions s
         JOIN durable_nodes n ON n.execution_id=s.execution_id AND n.node_id=s.node_id
         WHERE s.signal_id=? AND s.watermark<? AND n.status='pending'
         ORDER BY s.execution_id LIMIT ${MAX_WAKEUP_FANOUT}`
      ).all(request.signalId, sequence) as readonly { readonly execution_id: string }[]
      return {
        duplicate: false,
        sequence,
        payloadDigest,
        deliveryDigest,
        notifiedExecutions: waiters.map((row) => row.execution_id)
      }
    })
    const result = transaction.immediate()
    // Strictly after COMMIT: a woken coordinator re-reads its subscription.
    for (const executionId of result.notifiedExecutions) this.wakeups.notify(executionId)
    return result
  }

  /**
   * Retention sweep for delivered broadcasts.
   *
   * RULE: a delivery may be deleted only when it is older than `retentionMs`
   * AND no live subscription could still claim it — that is, its sequence is at
   * or below the lowest watermark among every non-terminal subscribed node for
   * that signal. A signal with no live subscribers has no floor, so its aged
   * deliveries are collectable. Consumption records are never deleted: they
   * carry their own payload digest and remain each waiter's durable evidence.
   */
  collectBroadcastDeliveries(
    retentionMs: number,
    now = Date.now()
  ): BroadcastCollectionResult {
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 0 || !Number.isSafeInteger(now) || now < 0) {
      throw new TypeError("Durable broadcast retention window must use non-negative safe integers")
    }
    const transaction = this.database.transaction((): BroadcastCollectionResult => {
      const aged = this.database.query(
        "SELECT sequence,signal_id FROM durable_broadcast_deliveries WHERE delivered_at<=? ORDER BY sequence"
      ).all(now - retentionMs) as readonly { readonly sequence: number; readonly signal_id: string }[]
      let deleted = 0
      for (const row of aged) {
        const floor = this.database.query(
          `SELECT MIN(s.watermark) AS floor
           FROM durable_broadcast_subscriptions s
           JOIN durable_nodes n ON n.execution_id=s.execution_id AND n.node_id=s.node_id
           WHERE s.signal_id=? AND n.status IN ('pending','running')`
        ).get(row.signal_id) as { readonly floor: number | null }
        if (floor.floor !== null && row.sequence > floor.floor) continue
        this.database.query("DELETE FROM durable_broadcast_deliveries WHERE sequence=?").run(row.sequence)
        deleted += 1
      }
      return { examined: aged.length, deleted }
    })
    return transaction.immediate()
  }

  /**
   * Appends one item to a durable queue. FIFO order is commit order: the
   * sequence is assigned inside this transaction. `(queueId, idempotencyKey)`
   * is the producer's deduplication identity — a repeat with equal payload
   * bytes adopts the existing item, an unequal payload fails closed. The item
   * schema comes only from the pinned queue registry.
   */
  enqueue(
    untrustedRequest: QueueEnqueueRequest,
    untrustedExpectation: QueueContractExpectation,
    authorization: { readonly producerToken?: string; readonly unsafeLocalDelivery?: true } = {}
  ): QueueEnqueueResult {
    const normalizedRequest = assertJson(untrustedRequest, "durable queue enqueue request")
    if (
      normalizedRequest === null || Array.isArray(normalizedRequest) || typeof normalizedRequest !== "object" ||
      canonicalJson(Object.keys(normalizedRequest).sort()) !== canonicalJson([
        "idempotencyKey", "item", "queueId"
      ])
    ) throw new TypeError("Durable queue enqueue request must have exact fields")
    const request = normalizedRequest as unknown as QueueEnqueueRequest
    const normalizedExpectation = assertJson(untrustedExpectation, "durable queue contract expectation")
    if (
      normalizedExpectation === null || Array.isArray(normalizedExpectation) || typeof normalizedExpectation !== "object" ||
      canonicalJson(Object.keys(normalizedExpectation).sort()) !== canonicalJson([
        "queueContractDigest", "queueId"
      ]) ||
      typeof normalizedExpectation.queueContractDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(normalizedExpectation.queueContractDigest) ||
      typeof normalizedExpectation.queueId !== "string"
    ) throw new TypeError("Durable queue contract expectation is invalid")
    const expectation = normalizedExpectation as unknown as QueueContractExpectation
    assertBoundedIdentity("queue id", request.queueId, 128)
    assertBoundedIdentity("idempotency key", request.idempotencyKey, 512)
    this.authorizeOpaqueToken(
      authorization,
      "producerToken",
      "queue enqueue",
      () => this.computeQueueToken(request.queueId),
      "Durable queue enqueue requires a minted producer token or explicit unsafeLocalDelivery",
      `Producer token does not authorize queue ${request.queueId}`,
      QueueEnqueueRejectedError
    )
    const transaction = this.database.transaction((): QueueEnqueueResult => {
      const now = Date.now()
      const registry = this.queueRegistry(request.queueId)
      if (
        registry.contractDigest !== expectation.queueContractDigest ||
        expectation.queueId !== request.queueId
      ) {
        throw new QueueEnqueueRejectedError(
          `Queue contract does not match the pinned registry for queue ${request.queueId}`
        )
      }
      let item: JsonValue
      try {
        item = validateDurableValue(registry.schema, request.item, `queue ${request.queueId} item`)
      } catch (error) {
        throw new QueueEnqueueRejectedError(
          `Queue ${request.queueId} item was rejected: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      const payloadDigest = digest(item)
      const existing = this.database.query(
        "SELECT * FROM durable_queue_items WHERE queue_id=? AND idempotency_key=?"
      ).get(request.queueId, request.idempotencyKey) as {
        readonly sequence: number
        readonly payload_digest: string
        readonly item_digest: string
        readonly state: QueueItemState
      } | null
      if (existing !== null) {
        if (existing.payload_digest !== payloadDigest) {
          throw new QueueEnqueueConflictError(
            `Queue ${request.queueId} already holds a different item under key ${request.idempotencyKey}`
          )
        }
        return {
          duplicate: true,
          sequence: existing.sequence,
          state: existing.state,
          payloadDigest,
          itemDigest: existing.item_digest
        }
      }
      const inserted = this.database.query(
        `INSERT INTO durable_queue_items(
          queue_id,idempotency_key,payload_json,payload_digest,schema_digest,item_digest,state,enqueued_at
        ) VALUES(?,?,?,?,?,'','pending',?)`
      ).run(
        request.queueId,
        request.idempotencyKey,
        canonicalJson(item),
        payloadDigest,
        registry.schemaDigest,
        now
      )
      const sequence = Number(inserted.lastInsertRowid)
      const itemDigest = digest({
        formatVersion: 1,
        sequence,
        queueId: request.queueId,
        idempotencyKey: request.idempotencyKey,
        payloadDigest,
        schemaDigest: registry.schemaDigest,
        enqueuedAt: now
      })
      this.database.query("UPDATE durable_queue_items SET item_digest=? WHERE sequence=?")
        .run(itemDigest, sequence)
      return { duplicate: false, sequence, state: "pending", payloadDigest, itemDigest }
    })
    const result = transaction.immediate()
    if (!result.duplicate) {
      // Strictly after COMMIT. Which executions wait on a queue is durable
      // state, so this read is a fast path only; the sweep is the guarantee.
      const waiters = this.database.query(
        `SELECT DISTINCT c.execution_id AS execution_id
         FROM durable_queue_contracts c
         JOIN durable_nodes n ON n.execution_id=c.execution_id AND n.node_id=c.node_id
         WHERE c.queue_id=? AND n.status='pending' AND n.queue_waiting_at IS NOT NULL
         ORDER BY c.execution_id LIMIT ${MAX_WAKEUP_FANOUT}`
      ).all(request.queueId) as readonly { readonly execution_id: string }[]
      for (const row of waiters) this.wakeups.notify(row.execution_id)
    }
    return result
  }

  /**
   * Poll/consume one queue item without acquiring a worker lease. The head
   * item's terminal state, the node's success, and the journal evidence all
   * transition in one `BEGIN IMMEDIATE` transaction, so two coordinators can
   * never hand the same item to two consumers and a crash between them is
   * impossible.
   */
  pollQueue(
    executionId: string,
    nodeId: string,
    untrustedExpectation: QueuePollExpectation
  ): QueuePollResult {
    const normalizedExpectation = assertJson(untrustedExpectation, "durable queue poll expectation")
    if (
      normalizedExpectation === null || Array.isArray(normalizedExpectation) || typeof normalizedExpectation !== "object" ||
      canonicalJson(Object.keys(normalizedExpectation).sort()) !== canonicalJson([
        "planDigest", "queueContractDigest", "queueId"
      ]) ||
      typeof normalizedExpectation.planDigest !== "string" || !/^[0-9a-f]{64}$/.test(normalizedExpectation.planDigest) ||
      typeof normalizedExpectation.queueContractDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(normalizedExpectation.queueContractDigest) ||
      typeof normalizedExpectation.queueId !== "string"
    ) throw new TypeError("Durable queue poll expectation is invalid")
    const expectation = normalizedExpectation as unknown as QueuePollExpectation
    const transaction = this.database.transaction((): QueuePollResult => {
      const node = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, nodeId) as NodeRow | null
      if (node === null || node.node_kind !== "queue") {
        throw new TypeError(`Unknown durable queue node ${executionId}/${nodeId}`)
      }
      const execution = this.database.query(
        "SELECT plan_digest,plan_generation FROM durable_executions WHERE id=?"
      ).get(executionId) as { readonly plan_digest: string; readonly plan_generation: number } | null
      if (execution === null) throw new Error(`Unknown durable execution ${executionId}`)
      if (execution.plan_digest !== expectation.planDigest) {
        throw new ExecutionMigratedError(
          executionId,
          expectation.planDigest,
          execution.plan_digest,
          execution.plan_generation
        )
      }
      const contract = this.queueContract(executionId, nodeId)
      if (
        contract.queueId !== expectation.queueId ||
        contract.contractDigest !== expectation.queueContractDigest
      ) {
        throw new ContentIntegrityError(`queue ${executionId}/${nodeId} disagrees with the coordinator Plan`)
      }
      const consumed = this.database.query(
        `SELECT sequence,payload_digest FROM durable_queue_items
         WHERE consumed_execution_id=? AND consumed_node_id=?`
      ).get(executionId, nodeId) as {
        readonly sequence: number
        readonly payload_digest: string
      } | null
      const terminal = nodeExit(node)
      if (terminal !== undefined) {
        if (terminal.kind === "success") {
          if (
            consumed === null || consumed.payload_digest !== node.result_digest ||
            digest(terminal.value) !== consumed.payload_digest
          ) {
            throw new ContentIntegrityError(
              `queue ${executionId}/${nodeId} terminal value disagrees with its consumed item`
            )
          }
        } else if (consumed !== null) {
          throw new ContentIntegrityError(
            `queue ${executionId}/${nodeId} holds a consumed item under a non-success exit`
          )
        }
        return {
          kind: "terminal",
          exit: terminal,
          newlyConsumed: false,
          ...(consumed === null ? {} : { sequence: consumed.sequence })
        }
      }
      if (consumed !== null) {
        throw new ContentIntegrityError(
          `queue ${executionId}/${nodeId} consumed an item without a terminal node exit`
        )
      }
      if (
        node.status !== "pending" || node.owner !== null || node.lease_until !== null ||
        node.retry_at !== null || node.wake_at !== null || node.attempt !== 0
      ) {
        throw new ContentIntegrityError(`queue ${executionId}/${nodeId} has invalid suspended scheduling state`)
      }
      const now = Date.now()
      const head = this.database.query(
        `SELECT * FROM durable_queue_items
         WHERE queue_id=? AND state='pending' ORDER BY sequence LIMIT 1`
      ).get(contract.queueId) as {
        readonly sequence: number
        readonly queue_id: string
        readonly idempotency_key: string
        readonly payload_json: string
        readonly payload_digest: string
        readonly schema_digest: string
        readonly item_digest: string
        readonly enqueued_at: number
      } | null
      if (head === null) {
        const update = this.database.query(
          `UPDATE durable_nodes SET queue_waiting_at=?,updated_at=?
           WHERE execution_id=? AND node_id=? AND node_kind='queue' AND status='pending'
             AND queue_waiting_at IS NULL AND owner IS NULL AND lease_until IS NULL AND attempt=0`
        ).run(now, now, executionId, nodeId)
        if (update.changes === 1) {
          this.emit(executionId, nodeId, "queue_waiting", {
            queueId: contract.queueId,
            schemaDigest: contract.schemaDigest
          }, now)
        }
        return { kind: "waiting", newlyWaiting: update.changes === 1 }
      }
      if (head.schema_digest !== contract.schemaDigest) {
        throw new ContentIntegrityError(
          `queue ${contract.queueId} item ${head.sequence} was stored under a different item schema`
        )
      }
      const label = `queue ${contract.queueId} item ${head.sequence}`
      const payload = parseJson(head.payload_json, head.payload_digest, `${label} payload`)
      const expectedItemDigest = digest({
        formatVersion: 1,
        sequence: head.sequence,
        queueId: head.queue_id,
        idempotencyKey: head.idempotency_key,
        payloadDigest: head.payload_digest,
        schemaDigest: head.schema_digest,
        enqueuedAt: head.enqueued_at
      })
      if (head.item_digest !== expectedItemDigest) {
        throw new ContentIntegrityError(`${label} digest mismatch`)
      }
      try {
        validateDurableValue(contract.schema, payload, `${label} payload`)
      } catch (error) {
        throw new ContentIntegrityError(
          `${label} violates its persisted schema: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      const claimed = this.database.query(
        `UPDATE durable_queue_items SET state='consumed',consumed_at=?,consumed_execution_id=?,consumed_node_id=?
         WHERE sequence=? AND state='pending'`
      ).run(now, executionId, nodeId, head.sequence)
      const succeeded = this.database.query(
        `UPDATE durable_nodes SET status='succeeded',result_json=?,result_digest=?,error_json=NULL,
          error_digest=NULL,queue_waiting_at=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND node_kind='queue' AND status='pending'
           AND owner IS NULL AND lease_until IS NULL AND retry_at IS NULL AND wake_at IS NULL AND attempt=0`
      ).run(canonicalJson(payload), head.payload_digest, now, executionId, nodeId)
      if (claimed.changes !== 1 || succeeded.changes !== 1) {
        throw new Error(`Durable queue ${executionId}/${nodeId} lost its atomic consume race`)
      }
      this.emit(executionId, nodeId, "queue_item_consumed", {
        queueId: head.queue_id,
        sequence: head.sequence,
        idempotencyKey: head.idempotency_key,
        payloadDigest: head.payload_digest,
        itemDigest: head.item_digest
      }, now)
      this.emit(executionId, nodeId, "node_succeeded", {
        attempt: 0,
        fencingToken: node.fence,
        resultDigest: head.payload_digest,
        adoptedFrom: null,
        coordinatorOwned: "queue"
      }, now)
      return {
        kind: "terminal",
        exit: { kind: "success", value: payload, adoptedFrom: null },
        newlyConsumed: true,
        sequence: head.sequence
      }
    })
    return transaction.immediate()
  }

  /**
   * Applies one EXPLICIT, opt-in migration to an in-flight execution.
   *
   * The compatibility judgment is re-derived here from the two validated
   * artifacts and this execution's own durable rows; nothing about it is taken
   * on the caller's word. Rewriting the pinned digests, fencing every in-flight
   * attempt, and journaling the migration event all commit in one transaction,
   * so no state exists in which an execution is half-migrated. Re-applying an
   * already-applied migration is idempotent, which is what makes a crash
   * immediately after this COMMIT recoverable.
   */
  migrateExecution(executionId: string, migration: MigrationPlan): {
    readonly applied: boolean
    readonly fencedNodeIds: readonly string[]
    readonly generation: number
  } {
    assertBoundedIdentity("execution id", executionId, 512)
    // Rebuild (and thereby revalidate) the migration from its own artifacts.
    const checked = planExecutionMigration(migration?.from, migration?.to)
    if (checked.digest !== migration.digest) {
      throw new MigrationRejectedError(
        "pinned-digest-mismatch",
        `Migration digest ${migration.digest} does not match its own artifacts`
      )
    }
    const transaction = this.database.transaction(() => {
      const row = this.database.query(
        "SELECT * FROM durable_executions WHERE id=?"
      ).get(executionId) as ExecutionRow | null
      if (row === null) {
        throw new MigrationRejectedError("unknown-execution", `Unknown durable execution ${executionId}`)
      }
      const generation = row.plan_generation ?? 0
      if (row.plan_digest === checked.toPlanDigest && row.manifest_digest === checked.toManifestDigest) {
        return { applied: false, fencedNodeIds: [] as readonly string[], generation }
      }
      if (row.status !== "running") {
        throw new MigrationRejectedError(
          "terminal-execution",
          `Execution ${executionId} is ${row.status} and cannot be migrated`
        )
      }
      if (row.flow_id !== checked.flowId) {
        throw new MigrationRejectedError(
          "flow-identity-changed",
          `Execution ${executionId} runs Flow ${row.flow_id}, not ${checked.flowId}`
        )
      }
      if (row.plan_digest !== checked.fromPlanDigest || row.manifest_digest !== checked.fromManifestDigest) {
        throw new MigrationRejectedError(
          "pinned-digest-mismatch",
          `Execution ${executionId} is not pinned to the migration's source Plan and manifest`
        )
      }
      const nodes = this.database.query(
        "SELECT node_id,node_kind,status FROM durable_nodes WHERE execution_id=? ORDER BY node_id"
      ).all(executionId) as readonly {
        readonly node_id: string
        readonly node_kind: string | null
        readonly status: NodeStatus
      }[]
      const materializedTemplateIds = [
        ...(this.database.query(
          "SELECT DISTINCT fanout_node_id AS id FROM durable_fanout_items WHERE execution_id=?"
        ).all(executionId) as readonly { readonly id: string }[]),
        ...(this.database.query(
          "SELECT DISTINCT loop_node_id AS id FROM durable_loop_rounds WHERE execution_id=?"
        ).all(executionId) as readonly { readonly id: string }[])
      ].map((entry) => entry.id)
      const linkedChildFlowIds = (this.database.query(
        "SELECT node_id FROM durable_child_executions WHERE parent_execution_id=?"
      ).all(executionId) as readonly { readonly node_id: string }[]).map((entry) => entry.node_id)
      const evidence: ExecutionMigrationEvidence = {
        committedNodeIds: nodes
          .filter((entry) => isCommittedNodeStatus(entry.status))
          .map((entry) => entry.node_id),
        materializedTemplateIds,
        linkedChildFlowIds
      }
      assertNodeMigrationCompatible(checked.from.plan, checked.to.plan, evidence)
      // The pinned input is re-checked against the target contract from the
      // persisted bytes, not from anything the caller supplied.
      const input = parseJson(row.input_json, row.input_digest, `execution ${executionId} input`)
      const targetInput = checked.to.plan.flowSchemas?.input
      if (targetInput !== undefined) {
        try {
          validateDurableValue(targetInput, input, `execution ${executionId} input`)
        } catch (error) {
          throw new MigrationRejectedError(
            "pinned-input-rejected",
            `Persisted Flow input does not satisfy the target contract: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      const now = Date.now()
      // Fence every live attempt: an attempt admitted under the old pinned code
      // must not be able to commit under the new one.
      const fencedNodeIds: string[] = []
      for (const entry of nodes) {
        if (entry.status !== "running") continue
        const fenced = this.database.query(
          `UPDATE durable_nodes SET status='pending',owner=NULL,lease_until=NULL,retry_at=NULL,
            fence=fence+1,updated_at=?
           WHERE execution_id=? AND node_id=? AND status='running'`
        ).run(now, executionId, entry.node_id)
        if (fenced.changes === 1) fencedNodeIds.push(entry.node_id)
      }
      const applied = this.database.query(
        `UPDATE durable_executions SET plan_digest=?,manifest_digest=?,plan_generation=plan_generation+1,updated_at=?
         WHERE id=? AND status='running' AND plan_digest=? AND manifest_digest=?`
      ).run(
        checked.toPlanDigest,
        checked.toManifestDigest,
        now,
        executionId,
        checked.fromPlanDigest,
        checked.fromManifestDigest
      )
      if (applied.changes !== 1) {
        throw new MigrationRejectedError(
          "pinned-digest-mismatch",
          `Execution ${executionId} lost its migration race`
        )
      }
      this.emit(executionId, null, "execution_migrated", {
        migrationDigest: checked.digest,
        fromPlanDigest: checked.fromPlanDigest,
        toPlanDigest: checked.toPlanDigest,
        fromManifestDigest: checked.fromManifestDigest,
        toManifestDigest: checked.toManifestDigest,
        committedNodeIds: evidence.committedNodeIds,
        fencedNodeIds
      }, now)
      return { applied: true, fencedNodeIds: fencedNodeIds as readonly string[], generation: generation + 1 }
    })
    const result = transaction.immediate()
    // Strictly after COMMIT: a stale coordinator suspended on this execution
    // wakes, re-reads the pinned digest, and abandons without terminalizing it.
    if (result.applied) this.wakeups.notify(executionId)
    return result
  }

  /**
   * Establishes one absolute wake deadline for a timer node. This transaction
   * is the timer's durable suspension point: every coordinator sees the same
   * timestamp after a crash or concurrent resume.
   */
  scheduleTimer(
    executionId: string,
    nodeId: string,
    durationMs: number,
    now = Date.now()
  ): TimerScheduleResult {
    if (
      !Number.isSafeInteger(durationMs) || durationMs < 0 ||
      !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(now + durationMs)
    ) {
      throw new TypeError("Durable timer duration and wake timestamp must be non-negative safe integers")
    }
    const transaction = this.database.transaction((): TimerScheduleResult => {
      const row = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id = ? AND node_id = ?"
      ).get(executionId, nodeId) as NodeRow | null
      if (row === null) throw new Error(`Unknown durable node ${executionId}/${nodeId}`)
      if (row.node_kind !== "timer") {
        throw new TypeError(`Durable node ${executionId}/${nodeId} is not a timer`)
      }
      const terminal = nodeExit(row)
      if (terminal !== undefined) return { kind: "terminal", exit: terminal }
      if (row.wake_at !== null) {
        return { kind: "waiting", wakeAt: row.wake_at, newlyScheduled: false }
      }
      if (row.status !== "pending" || row.retry_at !== null || row.owner !== null || row.lease_until !== null) {
        throw new Error(`Durable timer ${executionId}/${nodeId} reached an invalid unscheduled state`)
      }
      const wakeAt = now + durationMs
      const update = this.database.query(
        `UPDATE durable_nodes SET wake_at=?,updated_at=?
         WHERE execution_id=? AND node_id=? AND node_kind='timer' AND status='pending'
           AND wake_at IS NULL AND retry_at IS NULL AND owner IS NULL AND lease_until IS NULL`
      ).run(wakeAt, now, executionId, nodeId)
      if (update.changes !== 1) {
        const winner = this.database.query(
          "SELECT * FROM durable_nodes WHERE execution_id = ? AND node_id = ?"
        ).get(executionId, nodeId) as NodeRow
        const winnerExit = nodeExit(winner)
        if (winnerExit !== undefined) return { kind: "terminal", exit: winnerExit }
        if (winner.wake_at !== null) {
          return { kind: "waiting", wakeAt: winner.wake_at, newlyScheduled: false }
        }
        throw new Error(`Durable timer ${executionId}/${nodeId} could not persist its wake deadline`)
      }
      this.emit(executionId, nodeId, "timer_scheduled", { durationMs, wakeAt }, now)
      return { kind: "waiting", wakeAt, newlyScheduled: true }
    })
    const result = transaction.immediate()
    if (result.kind === "waiting" && result.newlyScheduled) this.wakeups.notify(executionId)
    return result
  }

  claimNode(
    executionId: string,
    nodeId: string,
    owner: string,
    leaseMs: number,
    now = Date.now(),
    expectedPlanDigest?: string
  ): ClaimResult {
    if (typeof owner !== "string" || owner.trim() === "") {
      throw new TypeError("Durable node lease owner must be non-empty")
    }
    if (
      !Number.isSafeInteger(leaseMs) || leaseMs <= 0 ||
      !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(now + leaseMs)
    ) {
      throw new TypeError("Durable node lease must use safe positive integer timestamps")
    }
    const transaction = this.database.transaction((): ClaimResult => {
      this.assertPinnedPlan(executionId, expectedPlanDigest)
      const row = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id = ? AND node_id = ?"
      ).get(executionId, nodeId) as NodeRow | null
      if (row === null) throw new Error(`Unknown durable node ${executionId}/${nodeId}`)
      const terminal = nodeExit(row)
      if (terminal !== undefined) return { kind: "terminal", exit: terminal }
      if (row.node_kind === "signal") {
        throw new Error(`Durable signal ${executionId}/${nodeId} cannot acquire a worker lease`)
      }
      if (row.node_kind === "queue") {
        throw new Error(`Durable queue ${executionId}/${nodeId} cannot acquire a worker lease`)
      }
      if (row.node_kind === "timer" && row.wake_at === null) {
        throw new Error(`Durable timer ${executionId}/${nodeId} must be scheduled before it can be claimed`)
      }
      // The wake deadline gates every state, including a formerly-due running
      // lease observed after wall-clock rollback. A timer is never stealable
      // or completable before the absolute persisted time.
      if (row.wake_at !== null && row.wake_at > now) {
        return { kind: "busy", leaseExpiresAt: row.wake_at }
      }
      if (row.status === "pending" && (row.retry_at ?? 0) > now) {
        return { kind: "busy", leaseExpiresAt: row.retry_at! }
      }
      if (row.status === "running" && (row.lease_until ?? 0) > now) {
        return { kind: "busy", leaseExpiresAt: row.lease_until! }
      }
      const attempt = row.attempt + 1
      const fence = row.fence + 1
      const leaseExpiresAt = now + leaseMs
      const stolen = row.status === "running"
      const update = this.database.query(
        `UPDATE durable_nodes SET status='running',attempt=?,fence=?,owner=?,lease_until=?,retry_at=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND fence=? AND status IN ('pending','running')`
      ).run(attempt, fence, owner, leaseExpiresAt, now, executionId, nodeId, row.fence)
      if (update.changes !== 1) return { kind: "busy", leaseExpiresAt: now + 5 }
      this.emit(executionId, nodeId, stolen ? "attempt_lease_stolen" : "attempt_started", {
        attempt,
        fencingToken: fence,
        owner,
        leaseExpiresAt
      }, now)
      return { kind: "claimed", attempt, fencingToken: fence, leaseExpiresAt, stolen }
    })
    return transaction.immediate()
  }

  heartbeat(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    leaseUntil: number
  ): boolean {
    if (
      typeof owner !== "string" || owner.trim() === "" ||
      !Number.isSafeInteger(fencingToken) || fencingToken < 1 ||
      !Number.isSafeInteger(leaseUntil) || leaseUntil < 0
    ) {
      throw new TypeError("Durable node heartbeat has an invalid owner, fence, or lease timestamp")
    }
    return this.database.query(
      `UPDATE durable_nodes SET lease_until=?,updated_at=?
       WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
    ).run(leaseUntil, Date.now(), executionId, nodeId, owner, fencingToken).changes === 1
  }

  scheduleRetry(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    exit: WorkerExit,
    retryAt: number
  ): boolean {
    const transaction = this.database.transaction(() => {
      const update = this.database.query(
        `UPDATE durable_nodes SET status='pending',owner=NULL,lease_until=NULL,retry_at=?,wake_at=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(retryAt, Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) return false
      this.emit(executionId, nodeId, "attempt_retry_scheduled", { fencingToken, retryAt, exit })
      return true
    })
    return transaction.immediate()
  }

  commitSuccess(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    value: JsonValue,
    adoptedFrom: string | null = null
  ): boolean {
    const normalizedValue = assertJson(value, "durable node success")
    const resultJson = canonicalJson(normalizedValue)
    const resultDigest = digest(normalizedValue)
    const transaction = this.database.transaction(() => {
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status='succeeded',result_json=?,result_digest=?,error_json=NULL,error_digest=NULL,
          adopted_from=?,owner=NULL,lease_until=NULL,retry_at=NULL,wake_at=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(resultJson, resultDigest, adoptedFrom, Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) return false
      // This journal event and the executable node exit commit in this one transaction.
      this.emit(executionId, nodeId, "node_succeeded", {
        fencingToken,
        resultDigest,
        adoptedFrom
      })
      return true
    })
    return transaction.immediate()
  }

  /**
   * Publishes a memo winner and the run-local node exit in one fenced
   * transaction. A stale attempt cannot leave a globally visible memo entry.
   */
  commitMemoSuccess(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    scope: string,
    generation: string,
    memoKey: string,
    candidate: JsonValue
  ): CachedSuccessCommit {
    const normalizedCandidate = assertJson(candidate, "durable memo success")
    const candidateJson = canonicalJson(normalizedCandidate)
    const candidateDigest = digest(normalizedCandidate)
    const adoptedFrom = `memo:${scope}:${generation}:${memoKey}`
    const transaction = this.database.transaction((): CachedSuccessCommit => {
      const ownsAttempt = this.database.query(
        `UPDATE durable_nodes SET updated_at=updated_at
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(executionId, nodeId, owner, fencingToken)
      if (ownsAttempt.changes !== 1) return { kind: "lost" }
      this.database.query(
        `INSERT OR IGNORE INTO durable_memo(scope,generation,memo_key,result_json,result_digest,created_at)
         VALUES(?,?,?,?,?,?)`
      ).run(scope, generation, memoKey, candidateJson, candidateDigest, Date.now())
      const winner = this.database.query(
        "SELECT result_json,result_digest FROM durable_memo WHERE scope=? AND generation=? AND memo_key=?"
      ).get(scope, generation, memoKey) as CacheRow
      const value = parseJson(winner.result_json, winner.result_digest, `memo ${scope}/${generation}/${memoKey}`)
      if (digest(value) !== winner.result_digest) {
        throw new ContentIntegrityError(`Memo key ${memoKey} contains corrupt output bytes`)
      }
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status='succeeded',result_json=?,result_digest=?,error_json=NULL,error_digest=NULL,
          adopted_from=?,owner=NULL,lease_until=NULL,retry_at=NULL,wake_at=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(winner.result_json, winner.result_digest, adoptedFrom, Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) throw new Error("Fenced memo/node transaction lost ownership after validation")
      this.emit(executionId, nodeId, "node_succeeded", {
        fencingToken,
        resultDigest: winner.result_digest,
        adoptedFrom
      })
      return { kind: "committed", value }
    })
    return transaction.immediate()
  }

  /** Content publication has the same fence and transaction as node adoption. */
  commitContentSuccess(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    contentKey: string,
    inputDigest: string,
    candidate: JsonValue
  ): CachedSuccessCommit {
    const normalizedCandidate = assertJson(candidate, "durable content success")
    const candidateJson = canonicalJson(normalizedCandidate)
    const candidateDigest = digest(normalizedCandidate)
    const adoptedFrom = `content:${contentKey}`
    const transaction = this.database.transaction((): CachedSuccessCommit => {
      const ownsAttempt = this.database.query(
        `UPDATE durable_nodes SET updated_at=updated_at
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(executionId, nodeId, owner, fencingToken)
      if (ownsAttempt.changes !== 1) return { kind: "lost" }
      this.database.query(
        `INSERT OR IGNORE INTO durable_content_cache(
          content_key,input_digest,result_json,result_digest,created_at
        ) VALUES(?,?,?,?,?)`
      ).run(contentKey, inputDigest, candidateJson, candidateDigest, Date.now())
      const winner = this.database.query(
        "SELECT input_digest,result_json,result_digest FROM durable_content_cache WHERE content_key=?"
      ).get(contentKey) as CacheRow
      if (winner.input_digest !== inputDigest || winner.result_digest !== candidateDigest) {
        throw new ContentIntegrityError(
          `Content action produced unequal output for complete key ${contentKey}; this is an integrity defect`
        )
      }
      const value = parseJson(winner.result_json, winner.result_digest, `content ${contentKey}`)
      if (digest(value) !== winner.result_digest) {
        throw new ContentIntegrityError(`Content key ${contentKey} contains corrupt output bytes`)
      }
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status='succeeded',result_json=?,result_digest=?,error_json=NULL,error_digest=NULL,
          adopted_from=?,owner=NULL,lease_until=NULL,retry_at=NULL,wake_at=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(winner.result_json, winner.result_digest, adoptedFrom, Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) throw new Error("Fenced content/node transaction lost ownership after validation")
      this.emit(executionId, nodeId, "node_succeeded", {
        fencingToken,
        resultDigest: winner.result_digest,
        adoptedFrom
      })
      return { kind: "committed", value }
    })
    return transaction.immediate()
  }

  adoptSuccess(
    executionId: string,
    nodeId: string,
    value: JsonValue,
    adoptedFrom: string,
    expectedPlanDigest?: string
  ): boolean {
    const normalizedValue = assertJson(value, "adopted durable node success")
    const resultJson = canonicalJson(normalizedValue)
    const resultDigest = digest(normalizedValue)
    const transaction = this.database.transaction(() => {
      this.assertPinnedPlan(executionId, expectedPlanDigest)
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status='succeeded',result_json=?,result_digest=?,error_json=NULL,error_digest=NULL,adopted_from=?,owner=NULL,lease_until=NULL,
          retry_at=NULL,wake_at=NULL,fence=fence+1,updated_at=?
         WHERE execution_id=? AND node_id=? AND status IN ('pending','running')`
      ).run(resultJson, resultDigest, adoptedFrom, Date.now(), executionId, nodeId)
      if (update.changes !== 1) return false
      this.emit(executionId, nodeId, "node_adopted", {
        adoptedFrom,
        resultDigest
      })
      return true
    })
    return transaction.immediate()
  }

  commitFailure(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    exit: Exclude<WorkerExit, { readonly kind: "success" }>
  ): boolean {
    const status = exit.kind === "failure" ? "failed" : "defect"
    const error = assertJson(
      exit.kind === "failure" ? exit.error : exit.defect,
      `durable node ${status}`
    )
    const transaction = this.database.transaction(() => {
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status=?,error_json=?,error_digest=?,result_json=NULL,result_digest=NULL,owner=NULL,lease_until=NULL,
          retry_at=NULL,wake_at=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(status, canonicalJson(error), digest(error), Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) return false
      this.emit(executionId, nodeId, exit.kind === "failure" ? "node_failed" : "node_defect", {
        fencingToken,
        error
      })
      return true
    })
    return transaction.immediate()
  }

  /** Fences a busy/pending attempt when the persisted execution deadline wins. */
  timeoutNode(
    executionId: string,
    nodeId: string,
    message: string,
    expectedPlanDigest?: string
  ): StoredNodeExit {
    const defect = { name: "DeadlineExceeded", message }
    const transaction = this.database.transaction((): StoredNodeExit => {
      this.assertPinnedPlan(executionId, expectedPlanDigest)
      const existing = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, nodeId) as NodeRow | null
      if (existing === null) throw new Error(`Unknown durable node ${executionId}/${nodeId}`)
      const terminal = nodeExit(existing)
      if (terminal !== undefined) return terminal
      const update = this.database.query(
        `UPDATE durable_nodes SET status='defect',error_json=?,error_digest=?,result_json=NULL,result_digest=NULL,
          owner=NULL,lease_until=NULL,retry_at=NULL,wake_at=NULL,signal_waiting_at=NULL,queue_waiting_at=NULL,
          fence=fence+1,updated_at=?
         WHERE execution_id=? AND node_id=? AND status IN ('pending','running')`
      ).run(canonicalJson(defect), digest(defect), Date.now(), executionId, nodeId)
      if (update.changes === 1) {
        if (existing.node_kind === "signal") {
          this.discardSignalInbox(executionId, nodeId, "deadline-exceeded", Date.now())
        }
        this.emit(executionId, nodeId, "node_defect", { fencingToken: existing.fence + 1, error: defect })
        return { kind: "defect", defect }
      }
      const winner = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, nodeId) as NodeRow
      return nodeExit(winner) ?? { kind: "defect", defect }
    })
    return transaction.immediate()
  }

  skipNodes(executionId: string, nodeIds: readonly string[], branchId: string): void {
    const now = Date.now()
    const transaction = this.database.transaction(() => {
      for (const nodeId of nodeIds) {
        const update = this.database.query(
          `UPDATE durable_nodes SET status='skipped',owner=NULL,lease_until=NULL,retry_at=NULL,wake_at=NULL,signal_waiting_at=NULL,queue_waiting_at=NULL,updated_at=?
           WHERE execution_id=? AND node_id=? AND status='pending'`
        ).run(now, executionId, nodeId)
        if (update.changes === 1) {
          this.discardSignalInbox(executionId, nodeId, `branch-skipped:${branchId}`, now)
          this.emit(executionId, nodeId, "node_skipped", { branchId }, now)
        }
      }
    })
    transaction.immediate()
  }

  completeExecution(
    executionId: string,
    output: JsonValue,
    expectedPlanDigest?: string
  ): FinishExecutionResult {
    const normalizedOutput = assertJson(output, "durable execution output")
    const outputJson = canonicalJson(normalizedOutput)
    const outputDigest = digest(normalizedOutput)
    const transaction = this.database.transaction((): FinishExecutionResult => {
      this.assertPinnedPlan(executionId, expectedPlanDigest)
      const current = this.database.query(
        "SELECT * FROM durable_executions WHERE id=?"
      ).get(executionId) as ExecutionRow | null
      if (current === null) throw new Error(`Unknown durable execution ${executionId}`)
      if (current.status !== "running") return { changed: false, execution: storedExecution(current) }
      const invalid = this.database.query(
        `SELECT COUNT(*) AS count FROM durable_nodes
         WHERE execution_id=? AND status NOT IN ('succeeded','skipped')`
      ).get(executionId) as { readonly count: number }
      if (invalid.count !== 0) {
        throw new Error(
          `Execution ${executionId} cannot complete with ${invalid.count} non-successful durable node(s)`
        )
      }
      const update = this.database.query(
        `UPDATE durable_executions SET status='completed',output_json=?,output_digest=?,
          error_json=NULL,error_digest=NULL,updated_at=?
         WHERE id=? AND status='running'`
      ).run(outputJson, outputDigest, Date.now(), executionId)
      if (update.changes === 1) {
        this.emit(executionId, null, "execution_completed", { outputDigest })
      }
      const row = this.database.query("SELECT * FROM durable_executions WHERE id=?").get(executionId) as ExecutionRow
      return { changed: update.changes === 1, execution: storedExecution(row) }
    })
    return transaction.immediate()
  }

  failExecution(
    executionId: string,
    category: "failure" | "defect",
    error: JsonValue,
    expectedPlanDigest?: string
  ): FinishExecutionResult {
    const normalizedError = assertJson(error, `durable execution ${category}`)
    const executionError = { category, error: normalizedError }
    const affected = new Set([executionId])
    const transaction = this.database.transaction(() => {
      this.assertPinnedPlan(executionId, expectedPlanDigest)
      const update = this.database.query(
        `UPDATE durable_executions SET status='failed',output_json=NULL,output_digest=NULL,
          error_json=?,error_digest=?,updated_at=?
         WHERE id=? AND status='running'`
      ).run(canonicalJson(executionError), digest(executionError), Date.now(), executionId)
      if (update.changes === 1) {
        const reason = { name: "ExecutionTerminated", category, error: normalizedError }
        this.fenceActiveNodes(executionId, reason, "execution-failed")
        this.emit(executionId, null, "execution_failed", { category, error: normalizedError })
        this.cancelDescendantExecutions(executionId, reason, affected)
      }
      const row = this.database.query("SELECT * FROM durable_executions WHERE id=?").get(executionId) as ExecutionRow
      return { changed: update.changes === 1, execution: storedExecution(row) }
    })
    const result = transaction.immediate()
    for (const id of affected) this.wakeups.notify(id)
    return result
  }

  memoGet(scope: string, generation: string, memoKey: string): JsonValue | undefined {
    const row = this.database.query(
      "SELECT result_json,result_digest FROM durable_memo WHERE scope=? AND generation=? AND memo_key=?"
    ).get(scope, generation, memoKey) as CacheRow | null
    if (row === null) return undefined
    const value = parseJson(row.result_json, row.result_digest, `memo ${scope}/${generation}/${memoKey}`)
    if (digest(value) !== row.result_digest) {
      throw new ContentIntegrityError(`Memo key ${memoKey} contains corrupt output bytes`)
    }
    return value
  }

  memoCommit(scope: string, generation: string, memoKey: string, candidate: JsonValue): JsonValue {
    const resultJson = canonicalJson(candidate)
    const resultDigest = digest(candidate)
    const transaction = this.database.transaction(() => {
      this.database.query(
        `INSERT OR IGNORE INTO durable_memo(scope,generation,memo_key,result_json,result_digest,created_at)
         VALUES(?,?,?,?,?,?)`
      ).run(scope, generation, memoKey, resultJson, resultDigest, Date.now())
      const winner = this.database.query(
        "SELECT result_json,result_digest FROM durable_memo WHERE scope=? AND generation=? AND memo_key=?"
      ).get(scope, generation, memoKey) as CacheRow
      const value = parseJson(winner.result_json, winner.result_digest, `memo ${scope}/${generation}/${memoKey}`)
      return value
    })
    return transaction.immediate()
  }

  contentGet(contentKey: string, expectedInputDigest: string): JsonValue | undefined {
    const row = this.database.query(
      "SELECT input_digest,result_json,result_digest FROM durable_content_cache WHERE content_key=?"
    ).get(contentKey) as CacheRow | null
    if (row === null) return undefined
    if (row.input_digest !== expectedInputDigest) {
      throw new ContentIntegrityError(`Content key ${contentKey} has unequal input evidence`)
    }
    const value = parseJson(row.result_json, row.result_digest, `content ${contentKey}`)
    if (digest(value) !== row.result_digest) {
      throw new ContentIntegrityError(`Content key ${contentKey} contains corrupt output bytes`)
    }
    return value
  }

  contentCommit(contentKey: string, inputDigest: string, candidate: JsonValue): JsonValue {
    const resultJson = canonicalJson(candidate)
    const resultDigest = digest(candidate)
    const transaction = this.database.transaction(() => {
      this.database.query(
        `INSERT OR IGNORE INTO durable_content_cache(
          content_key,input_digest,result_json,result_digest,created_at
        ) VALUES(?,?,?,?,?)`
      ).run(contentKey, inputDigest, resultJson, resultDigest, Date.now())
      const canonical = this.database.query(
        "SELECT input_digest,result_json,result_digest FROM durable_content_cache WHERE content_key=?"
      ).get(contentKey) as CacheRow
      if (canonical.input_digest !== inputDigest || canonical.result_digest !== resultDigest) {
        throw new ContentIntegrityError(
          `Content action produced unequal output for complete key ${contentKey}; this is an integrity defect`
        )
      }
      return parseJson(canonical.result_json, canonical.result_digest, `content ${contentKey}`)
    })
    return transaction.immediate()
  }

  journal(executionId: string): readonly JournalEvent[] {
    const rows = this.database.query(
      `SELECT sequence,execution_id,node_id,type,payload_json,payload_digest,timestamp
              ,event_digest
       FROM durable_journal WHERE execution_id=? ORDER BY sequence`
    ).all(executionId) as readonly {
      sequence: number
      execution_id: string
      node_id: string | null
      type: string
      payload_json: string
      payload_digest: string | null
      event_digest: string | null
      timestamp: number
    }[]
    return rows.map((row) => {
      const payload = parseJson(row.payload_json, row.payload_digest, `journal ${executionId}#${row.sequence}`)
      const expectedEventDigest = digest({
        sequence: row.sequence,
        executionId: row.execution_id,
        nodeId: row.node_id,
        type: row.type,
        payload,
        timestamp: row.timestamp
      })
      if (row.event_digest === null || row.event_digest !== expectedEventDigest) {
        throw new ContentIntegrityError(`journal ${executionId}#${row.sequence} failed event digest verification`)
      }
      return {
        sequence: row.sequence,
        executionId: row.execution_id,
        nodeId: row.node_id,
        type: row.type,
        payload,
        payloadDigest: row.payload_digest!,
        eventDigest: row.event_digest,
        timestamp: row.timestamp
      }
    })
  }
}

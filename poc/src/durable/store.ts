import { Database } from "bun:sqlite"
import {
  allPlanNodes,
  canonicalJson,
  type DeploymentManifest,
  digest,
  type JsonValue,
  type PlanTemplate,
  type WorkerExit
} from "./ir.ts"

export type ExecutionStatus = "running" | "completed" | "failed" | "cancelled"
export type NodeStatus = "pending" | "running" | "succeeded" | "failed" | "defect" | "skipped"

interface ExecutionRow {
  readonly id: string
  readonly flow_id: string
  readonly plan_digest: string
  readonly manifest_digest: string
  readonly input_json: string
  readonly deadline: number
  readonly status: ExecutionStatus
  readonly output_json: string | null
  readonly error_json: string | null
}

interface NodeRow {
  readonly execution_id: string
  readonly node_id: string
  readonly status: NodeStatus
  readonly attempt: number
  readonly fence: number
  readonly owner: string | null
  readonly lease_until: number | null
  readonly retry_at: number | null
  readonly result_json: string | null
  readonly error_json: string | null
  readonly adopted_from: string | null
}

interface CacheRow {
  readonly result_json: string
  readonly result_digest: string
  readonly input_digest?: string
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

export interface JournalEvent {
  readonly sequence: number
  readonly executionId: string
  readonly nodeId: string | null
  readonly type: string
  readonly payload: JsonValue
  readonly timestamp: number
}

export class ContentIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ContentIntegrityError"
  }
}

const parseJson = (text: string): JsonValue => JSON.parse(text) as JsonValue

const storedExecution = (row: ExecutionRow): StoredExecution => ({
  id: row.id,
  status: row.status,
  deadline: row.deadline,
  ...(row.output_json === null ? {} : { output: parseJson(row.output_json) }),
  ...(row.error_json === null ? {} : { error: parseJson(row.error_json) })
})

const nodeExit = (row: NodeRow): StoredNodeExit | undefined => {
  switch (row.status) {
    case "succeeded":
      return {
        kind: "success",
        value: parseJson(row.result_json!),
        adoptedFrom: row.adopted_from
      }
    case "failed":
      return { kind: "failure", error: parseJson(row.error_json!) }
    case "defect":
      return { kind: "defect", defect: parseJson(row.error_json!) }
    case "skipped":
      return { kind: "skipped" }
    case "pending":
    case "running":
      return undefined
  }
}

export class DurableStore {
  readonly database: Database

  constructor(filename = ":memory:") {
    this.database = new Database(filename, { create: true, strict: true })
    this.database.exec("PRAGMA journal_mode = WAL")
    this.database.exec("PRAGMA synchronous = FULL")
    this.database.exec("PRAGMA busy_timeout = 5000")
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS durable_executions (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        plan_digest TEXT NOT NULL,
        manifest_digest TEXT NOT NULL,
        input_json TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        status TEXT NOT NULL,
        output_json TEXT,
        error_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS durable_nodes (
        execution_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        fence INTEGER NOT NULL DEFAULT 0,
        owner TEXT,
        lease_until INTEGER,
        retry_at INTEGER,
        result_json TEXT,
        error_json TEXT,
        adopted_from TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (execution_id, node_id),
        FOREIGN KEY (execution_id) REFERENCES durable_executions(id)
      );
      CREATE TABLE IF NOT EXISTS durable_journal (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        node_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
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
    this.database.query(
      "INSERT INTO durable_journal(execution_id,node_id,type,payload_json,timestamp) VALUES(?,?,?,?,?)"
    ).run(executionId, nodeId, type, canonicalJson(payload), timestamp)
  }

  initializeExecution(
    executionId: string,
    plan: PlanTemplate,
    manifest: DeploymentManifest,
    input: JsonValue,
    deadline = Date.now() + 60_000
  ): StoredExecution {
    const inputJson = canonicalJson(input)
    const now = Date.now()
    const transaction = this.database.transaction(() => {
      const existing = this.database.query("SELECT * FROM durable_executions WHERE id = ?").get(executionId) as
        | ExecutionRow
        | null
      if (existing !== null) {
        if (
          existing.flow_id !== plan.flowId ||
          existing.plan_digest !== plan.digest ||
          existing.manifest_digest !== manifest.digest ||
          existing.input_json !== inputJson
        ) {
          throw new Error(
            `Execution ${executionId} is pinned to different input, Plan IR, schemas, or deployment manifest`
          )
        }
        return existing
      }
      this.database.query(
        `INSERT INTO durable_executions(
          id,flow_id,plan_digest,manifest_digest,input_json,deadline,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,'running',?,?)`
      ).run(executionId, plan.flowId, plan.digest, manifest.digest, inputJson, deadline, now, now)
      for (const node of allPlanNodes(plan)) {
        this.database.query(
          `INSERT INTO durable_nodes(execution_id,node_id,status,attempt,fence,updated_at)
           VALUES(?,?,'pending',0,0,?)`
        ).run(executionId, node.id, now)
      }
      this.emit(executionId, null, "execution_started", {
        flowId: plan.flowId,
        flowVersion: plan.flowVersion,
        planDigest: plan.digest,
        manifestDigest: manifest.digest,
        inputDigest: digest(input)
      }, now)
      return this.database.query("SELECT * FROM durable_executions WHERE id = ?").get(executionId) as ExecutionRow
    })
    const row = transaction()
    return storedExecution(row)
  }

  getNode(executionId: string, nodeId: string): { status: NodeStatus; exit?: StoredNodeExit } {
    const row = this.database.query(
      "SELECT * FROM durable_nodes WHERE execution_id = ? AND node_id = ?"
    ).get(executionId, nodeId) as NodeRow | null
    if (row === null) throw new Error(`Unknown durable node ${executionId}/${nodeId}`)
    const exit = nodeExit(row)
    return { status: row.status, ...(exit === undefined ? {} : { exit }) }
  }

  claimNode(
    executionId: string,
    nodeId: string,
    owner: string,
    leaseMs: number,
    now = Date.now()
  ): ClaimResult {
    const transaction = this.database.transaction((): ClaimResult => {
      const row = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id = ? AND node_id = ?"
      ).get(executionId, nodeId) as NodeRow | null
      if (row === null) throw new Error(`Unknown durable node ${executionId}/${nodeId}`)
      const terminal = nodeExit(row)
      if (terminal !== undefined) return { kind: "terminal", exit: terminal }
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
    return transaction()
  }

  heartbeat(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    leaseUntil: number
  ): boolean {
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
        `UPDATE durable_nodes SET status='pending',owner=NULL,lease_until=NULL,retry_at=?,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(retryAt, Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) return false
      this.emit(executionId, nodeId, "attempt_retry_scheduled", { fencingToken, retryAt, exit })
      return true
    })
    return transaction()
  }

  commitSuccess(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    value: JsonValue,
    adoptedFrom: string | null = null
  ): boolean {
    const resultJson = canonicalJson(value)
    const transaction = this.database.transaction(() => {
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status='succeeded',result_json=?,error_json=NULL,adopted_from=?,owner=NULL,lease_until=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(resultJson, adoptedFrom, Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) return false
      // This journal event and the executable node exit commit in this one transaction.
      this.emit(executionId, nodeId, "node_succeeded", {
        fencingToken,
        resultDigest: digest(value),
        adoptedFrom
      })
      return true
    })
    return transaction()
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
    const candidateJson = canonicalJson(candidate)
    const candidateDigest = digest(candidate)
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
      const value = parseJson(winner.result_json)
      if (digest(value) !== winner.result_digest) {
        throw new ContentIntegrityError(`Memo key ${memoKey} contains corrupt output bytes`)
      }
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status='succeeded',result_json=?,error_json=NULL,adopted_from=?,owner=NULL,lease_until=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(winner.result_json, adoptedFrom, Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) throw new Error("Fenced memo/node transaction lost ownership after validation")
      this.emit(executionId, nodeId, "node_succeeded", {
        fencingToken,
        resultDigest: winner.result_digest,
        adoptedFrom
      })
      return { kind: "committed", value }
    })
    return transaction()
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
    const candidateJson = canonicalJson(candidate)
    const candidateDigest = digest(candidate)
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
      const value = parseJson(winner.result_json)
      if (digest(value) !== winner.result_digest) {
        throw new ContentIntegrityError(`Content key ${contentKey} contains corrupt output bytes`)
      }
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status='succeeded',result_json=?,error_json=NULL,adopted_from=?,owner=NULL,lease_until=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(winner.result_json, adoptedFrom, Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) throw new Error("Fenced content/node transaction lost ownership after validation")
      this.emit(executionId, nodeId, "node_succeeded", {
        fencingToken,
        resultDigest: winner.result_digest,
        adoptedFrom
      })
      return { kind: "committed", value }
    })
    return transaction()
  }

  adoptSuccess(executionId: string, nodeId: string, value: JsonValue, adoptedFrom: string): boolean {
    const resultJson = canonicalJson(value)
    const transaction = this.database.transaction(() => {
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status='succeeded',result_json=?,error_json=NULL,adopted_from=?,owner=NULL,lease_until=NULL,
          fence=fence+1,updated_at=?
         WHERE execution_id=? AND node_id=? AND status IN ('pending','running')`
      ).run(resultJson, adoptedFrom, Date.now(), executionId, nodeId)
      if (update.changes !== 1) return false
      this.emit(executionId, nodeId, "node_adopted", {
        adoptedFrom,
        resultDigest: digest(value)
      })
      return true
    })
    return transaction()
  }

  commitFailure(
    executionId: string,
    nodeId: string,
    owner: string,
    fencingToken: number,
    exit: Exclude<WorkerExit, { readonly kind: "success" }>
  ): boolean {
    const status = exit.kind === "failure" ? "failed" : "defect"
    const error = exit.kind === "failure" ? exit.error : exit.defect
    const transaction = this.database.transaction(() => {
      const update = this.database.query(
        `UPDATE durable_nodes SET
          status=?,error_json=?,owner=NULL,lease_until=NULL,updated_at=?
         WHERE execution_id=? AND node_id=? AND status='running' AND owner=? AND fence=?`
      ).run(status, canonicalJson(error), Date.now(), executionId, nodeId, owner, fencingToken)
      if (update.changes !== 1) return false
      this.emit(executionId, nodeId, exit.kind === "failure" ? "node_failed" : "node_defect", {
        fencingToken,
        error
      })
      return true
    })
    return transaction()
  }

  /** Fences a busy/pending attempt when the persisted execution deadline wins. */
  timeoutNode(executionId: string, nodeId: string, message: string): StoredNodeExit {
    const defect = { name: "DeadlineExceeded", message }
    const transaction = this.database.transaction((): StoredNodeExit => {
      const existing = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, nodeId) as NodeRow | null
      if (existing === null) throw new Error(`Unknown durable node ${executionId}/${nodeId}`)
      const terminal = nodeExit(existing)
      if (terminal !== undefined) return terminal
      const update = this.database.query(
        `UPDATE durable_nodes SET status='defect',error_json=?,owner=NULL,lease_until=NULL,retry_at=NULL,
          fence=fence+1,updated_at=?
         WHERE execution_id=? AND node_id=? AND status IN ('pending','running')`
      ).run(canonicalJson(defect), Date.now(), executionId, nodeId)
      if (update.changes === 1) {
        this.emit(executionId, nodeId, "node_defect", { fencingToken: existing.fence + 1, error: defect })
        return { kind: "defect", defect }
      }
      const winner = this.database.query(
        "SELECT * FROM durable_nodes WHERE execution_id=? AND node_id=?"
      ).get(executionId, nodeId) as NodeRow
      return nodeExit(winner) ?? { kind: "defect", defect }
    })
    return transaction()
  }

  skipNodes(executionId: string, nodeIds: readonly string[], branchId: string): void {
    const now = Date.now()
    const transaction = this.database.transaction(() => {
      for (const nodeId of nodeIds) {
        const update = this.database.query(
          `UPDATE durable_nodes SET status='skipped',updated_at=?
           WHERE execution_id=? AND node_id=? AND status='pending'`
        ).run(now, executionId, nodeId)
        if (update.changes === 1) this.emit(executionId, nodeId, "node_skipped", { branchId }, now)
      }
    })
    transaction()
  }

  completeExecution(executionId: string, output: JsonValue): FinishExecutionResult {
    const transaction = this.database.transaction(() => {
      const update = this.database.query(
        `UPDATE durable_executions SET status='completed',output_json=?,error_json=NULL,updated_at=?
         WHERE id=? AND status='running'`
      ).run(canonicalJson(output), Date.now(), executionId)
      if (update.changes === 1) {
        this.emit(executionId, null, "execution_completed", { outputDigest: digest(output) })
      }
      const row = this.database.query("SELECT * FROM durable_executions WHERE id=?").get(executionId) as ExecutionRow
      return { changed: update.changes === 1, execution: storedExecution(row) }
    })
    return transaction()
  }

  failExecution(
    executionId: string,
    category: "failure" | "defect",
    error: JsonValue
  ): FinishExecutionResult {
    const transaction = this.database.transaction(() => {
      const update = this.database.query(
        `UPDATE durable_executions SET status='failed',error_json=?,updated_at=?
         WHERE id=? AND status='running'`
      ).run(canonicalJson({ category, error }), Date.now(), executionId)
      if (update.changes === 1) this.emit(executionId, null, "execution_failed", { category, error })
      const row = this.database.query("SELECT * FROM durable_executions WHERE id=?").get(executionId) as ExecutionRow
      return { changed: update.changes === 1, execution: storedExecution(row) }
    })
    return transaction()
  }

  memoGet(scope: string, generation: string, memoKey: string): JsonValue | undefined {
    const row = this.database.query(
      "SELECT result_json,result_digest FROM durable_memo WHERE scope=? AND generation=? AND memo_key=?"
    ).get(scope, generation, memoKey) as CacheRow | null
    if (row === null) return undefined
    const value = parseJson(row.result_json)
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
      return parseJson(winner.result_json)
    })
    return transaction()
  }

  contentGet(contentKey: string, expectedInputDigest: string): JsonValue | undefined {
    const row = this.database.query(
      "SELECT input_digest,result_json,result_digest FROM durable_content_cache WHERE content_key=?"
    ).get(contentKey) as CacheRow | null
    if (row === null) return undefined
    if (row.input_digest !== expectedInputDigest) {
      throw new ContentIntegrityError(`Content key ${contentKey} has unequal input evidence`)
    }
    const value = parseJson(row.result_json)
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
      return parseJson(canonical.result_json)
    })
    return transaction()
  }

  journal(executionId: string): readonly JournalEvent[] {
    const rows = this.database.query(
      `SELECT sequence,execution_id,node_id,type,payload_json,timestamp
       FROM durable_journal WHERE execution_id=? ORDER BY sequence`
    ).all(executionId) as readonly {
      sequence: number
      execution_id: string
      node_id: string | null
      type: string
      payload_json: string
      timestamp: number
    }[]
    return rows.map((row) => ({
      sequence: row.sequence,
      executionId: row.execution_id,
      nodeId: row.node_id,
      type: row.type,
      payload: parseJson(row.payload_json),
      timestamp: row.timestamp
    }))
  }
}

import { Database } from "bun:sqlite"
import type {
  FlowAttachment,
  FlowCallIdentity,
  HostCallIdentity,
  JournalArtifact,
  JournalEvent,
  JsonValue,
  ModelCallIdentity,
  ModelResponse,
  RecordedHostCall,
  SerializedError,
  TurnJournal,
} from "./types.ts"
import { canonicalIdentityJson, componentIdentityJson, sha256Json, sha256Text } from "./identity.ts"
import { jsonSnapshot, modelDescriptorJson, modelResponseJson, normalizeModelResponse } from "./model.ts"

const JOURNAL_SCHEMA = "vibelang.agent.turn-journal/v1"
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const MAX_ROW_JSON_BYTES = 8 * 1024 * 1024
const EVENT_TYPES = Object.freeze([
  "turn.started",
  "model.requested",
  "model.responded",
  "compile.completed",
  "sandbox.started",
  "function.called",
  "flow.attached",
  "function.completed",
  "sandbox.completed",
  "turn.completed",
])
const ARTIFACT_KINDS = Object.freeze(["generated-source", "compiled-javascript"])
const SHA256 = /^[a-f0-9]{64}$/

/** A persisted row failed its own digest: the journal refuses to serve it. */
export class TurnJournalIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TurnJournalIntegrityError"
  }
}

/**
 * A replayed turn asked for a recorded boundary under a different request,
 * input, or component identity than the one that was committed. Replay fails
 * closed rather than silently answering with the wrong recording.
 */
export class TurnJournalDivergenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TurnJournalDivergenceError"
  }
}

export interface StoredJournalEvent extends JournalEvent {
  readonly sequence: number
  readonly recordedAt: number
  readonly details: Record<string, JsonValue>
}

export interface StoredHostCall {
  readonly turnId: string
  readonly sourceDigest: string
  readonly functionName: string
  readonly ordinal: number
  readonly callId: number
  readonly inputDigest: string
  readonly recordedAt: number
  readonly call: RecordedHostCall
}

export interface StoredFlowCall {
  readonly turnId: string
  readonly sourceDigest: string
  readonly functionName: string
  readonly ordinal: number
  readonly executionId: string
  readonly flowId: string
  readonly flowVersion: number
  readonly planDigest: string
  readonly inputDigest: string
  readonly recordedAt: number
}

export interface SqliteTurnJournalOptions {
  /** Database file. Defaults to an anonymous in-memory database. */
  readonly path?: string
}

interface EventRow {
  sequence: number
  turn_id: string
  type: string
  attempt: number | null
  source_digest: string | null
  function_name: string | null
  call_id: number | null
  ordinal: number | null
  ok: number | null
  details_json: string
  recorded_at: number
  previous_digest: string
  event_digest: string
}

interface ArtifactRow {
  digest: string
  kind: string
  turn_id: string
  content: string
  byte_length: number
  recorded_at: number
  row_digest: string
}

interface ModelCallRow {
  turn_id: string
  attempt: number
  request_digest: string
  model_identity_json: string
  model_json: string
  response_json: string
  recorded_at: number
  row_digest: string
}

interface HostCallRow {
  turn_id: string
  source_digest: string
  function_name: string
  ordinal: number
  call_id: number
  function_identity_json: string
  contract_json: string
  input_digest: string
  outcome: string
  output_json: string | null
  error_json: string | null
  recorded_at: number
  row_digest: string
}

interface FlowCallRow {
  turn_id: string
  source_digest: string
  function_name: string
  ordinal: number
  execution_id: string
  flow_id: string
  flow_version: number
  plan_digest: string
  input_digest: string
  recorded_at: number
  row_digest: string
}

function boundedJson(value: JsonValue, label: string): string {
  const text = canonicalIdentityJson(value, label)
  if (Buffer.byteLength(text, "utf8") > MAX_ROW_JSON_BYTES) {
    throw new RangeError(`${label} exceeds the ${MAX_ROW_JSON_BYTES} byte journal row limit`)
  }
  return text
}

function rowDigest(kind: string, content: JsonValue): string {
  return sha256Json({ schema: JOURNAL_SCHEMA, kind, content })
}

function decodeRowJson(text: string, label: string): JsonValue {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch (error) {
    throw new TurnJournalIntegrityError(
      `${label} is not decodable JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    return JSON.parse(canonicalIdentityJson(decoded, label)) as JsonValue
  } catch (error) {
    throw new TurnJournalIntegrityError(
      `${label} is not canonical JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function eventContent(row: {
  turnId: string
  type: string
  attempt: number | null
  sourceDigest: string | null
  functionName: string | null
  callId: number | null
  ordinal: number | null
  ok: number | null
  details: JsonValue
  recordedAt: number
}): JsonValue {
  return {
    turnId: row.turnId,
    type: row.type,
    attempt: row.attempt,
    sourceDigest: row.sourceDigest,
    functionName: row.functionName,
    callId: row.callId,
    ordinal: row.ordinal,
    ok: row.ok,
    details: row.details,
    recordedAt: row.recordedAt,
  }
}

function eventDigest(sequence: number, previousDigest: string, content: JsonValue): string {
  return rowDigest("event", { sequence, previousDigest, content })
}

function optionalInteger(value: number | undefined, label: string): number | null {
  if (value === undefined) return null
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`)
  return value
}

function optionalDigest(value: string | undefined, label: string): string | null {
  if (value === undefined) return null
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TypeError(`${label} must be a bounded non-empty string`)
  }
  return value
}

function serializedError(value: JsonValue, label: string): SerializedError {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TurnJournalIntegrityError(`${label} is not a serialized error`)
  }
  const record = value as Record<string, JsonValue>
  if (typeof record.name !== "string" || typeof record.message !== "string") {
    throw new TurnJournalIntegrityError(`${label} is not a serialized error`)
  }
  return {
    name: record.name,
    message: record.message,
    ...(typeof record.stack === "string" ? { stack: record.stack } : {}),
    ...(record.fields !== undefined && record.fields !== null &&
      typeof record.fields === "object" && !Array.isArray(record.fields)
      ? { fields: record.fields as Record<string, JsonValue> }
      : {}),
  }
}

/**
 * The real durable turn store: one SQLite database, one transaction per
 * committed boundary, digest-checked on every read.
 *
 * Recording is unconditional; replay is only offered for boundaries that carry
 * durable semantics — the model response, and host calls whose binding has a
 * compiler-derived Action contract (AGENT_LIBRARY.md: "Only Action and Flow
 * calls receive durable execution semantics").
 */
export class SqliteTurnJournal implements TurnJournal {
  readonly database: Database
  readonly path: string

  constructor(options: SqliteTurnJournalOptions | string = {}) {
    const settings = typeof options === "string" ? { path: options } : options
    this.path = settings.path ?? ":memory:"
    this.database = new Database(this.path, { create: true, strict: true })
    this.database.exec("PRAGMA journal_mode = WAL")
    this.database.exec("PRAGMA synchronous = FULL")
    this.database.exec("PRAGMA busy_timeout = 5000")
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_journal_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_turn_events (
        sequence INTEGER PRIMARY KEY,
        turn_id TEXT NOT NULL,
        type TEXT NOT NULL,
        attempt INTEGER,
        source_digest TEXT,
        function_name TEXT,
        call_id INTEGER,
        ordinal INTEGER,
        ok INTEGER,
        details_json TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        previous_digest TEXT NOT NULL,
        event_digest TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_turn_events_by_turn
        ON agent_turn_events (turn_id, sequence);
      CREATE TABLE IF NOT EXISTS agent_turn_artifacts (
        digest TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        content TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        recorded_at INTEGER NOT NULL,
        row_digest TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_model_calls (
        turn_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        request_digest TEXT NOT NULL,
        model_identity_json TEXT NOT NULL,
        model_json TEXT NOT NULL,
        response_json TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        row_digest TEXT NOT NULL,
        PRIMARY KEY (turn_id, attempt)
      );
      CREATE TABLE IF NOT EXISTS agent_host_calls (
        turn_id TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        function_name TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        call_id INTEGER NOT NULL,
        function_identity_json TEXT NOT NULL,
        contract_json TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        outcome TEXT NOT NULL,
        output_json TEXT,
        error_json TEXT,
        recorded_at INTEGER NOT NULL,
        row_digest TEXT NOT NULL,
        PRIMARY KEY (turn_id, source_digest, function_name, ordinal)
      );
      CREATE TABLE IF NOT EXISTS agent_flow_calls (
        turn_id TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        function_name TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        execution_id TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        flow_version INTEGER NOT NULL,
        plan_digest TEXT NOT NULL,
        input_digest TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        row_digest TEXT NOT NULL,
        PRIMARY KEY (turn_id, source_digest, function_name, ordinal)
      );
    `)
    this.database.query(
      "INSERT INTO agent_journal_meta (key, value) VALUES ('schema', $schema) ON CONFLICT (key) DO NOTHING",
    ).run({ schema: JOURNAL_SCHEMA })
    const schema = this.database
      .query("SELECT value FROM agent_journal_meta WHERE key = 'schema'")
      .get() as { value: string } | null
    if (schema?.value !== JOURNAL_SCHEMA) {
      this.database.close()
      throw new TurnJournalIntegrityError(
        `Journal at ${this.path} has schema ${schema?.value ?? "<missing>"}, expected ${JOURNAL_SCHEMA}`,
      )
    }
  }

  close(): void {
    this.database.close()
  }

  append(event: JournalEvent): void {
    if (typeof event.turnId !== "string" || event.turnId.length === 0 || event.turnId.length > 256) {
      throw new TypeError("Journal event turnId must be a bounded non-empty string")
    }
    if (!EVENT_TYPES.includes(event.type)) {
      throw new TypeError(`Journal event type is not part of the turn vocabulary: ${event.type}`)
    }
    const details = event.details === undefined
      ? {}
      : jsonSnapshot(event.details, `Journal ${event.type} details`)
    const detailsJson = boundedJson(details, `Journal ${event.type} details`)
    const row = {
      turnId: event.turnId,
      type: event.type,
      attempt: optionalInteger(event.attempt, "Journal event attempt"),
      sourceDigest: optionalDigest(event.sourceDigest, "Journal event sourceDigest"),
      functionName: event.functionName === undefined ? null : String(event.functionName),
      callId: optionalInteger(event.callId, "Journal event callId"),
      ordinal: optionalInteger(event.ordinal, "Journal event ordinal"),
      ok: event.ok === undefined ? null : (event.ok ? 1 : 0),
      details: JSON.parse(detailsJson) as JsonValue,
      recordedAt: Date.now(),
    }
    const insert = this.database.transaction(() => {
      const head = this.database
        .query("SELECT sequence, event_digest FROM agent_turn_events ORDER BY sequence DESC LIMIT 1")
        .get() as { sequence: number; event_digest: string } | null
      const sequence = (head?.sequence ?? 0) + 1
      const previousDigest = head?.event_digest ?? sha256Text(`${JOURNAL_SCHEMA}:genesis`)
      const digest = eventDigest(sequence, previousDigest, eventContent(row))
      this.database.query(`
        INSERT INTO agent_turn_events (
          sequence, turn_id, type, attempt, source_digest, function_name, call_id,
          ordinal, ok, details_json, recorded_at, previous_digest, event_digest
        ) VALUES (
          $sequence, $turnId, $type, $attempt, $sourceDigest, $functionName, $callId,
          $ordinal, $ok, $detailsJson, $recordedAt, $previousDigest, $eventDigest
        )
      `).run({
        sequence,
        turnId: row.turnId,
        type: row.type,
        attempt: row.attempt,
        sourceDigest: row.sourceDigest,
        functionName: row.functionName,
        callId: row.callId,
        ordinal: row.ordinal,
        ok: row.ok,
        detailsJson,
        recordedAt: row.recordedAt,
        previousDigest,
        eventDigest: digest,
      })
    })
    insert.immediate()
  }

  putArtifact(artifact: JournalArtifact): void {
    if (!ARTIFACT_KINDS.includes(artifact.kind)) {
      throw new TypeError(`Journal artifact kind is unsupported: ${artifact.kind}`)
    }
    if (typeof artifact.content !== "string") throw new TypeError("Journal artifact content must be a string")
    const byteLength = Buffer.byteLength(artifact.content, "utf8")
    if (byteLength > MAX_ARTIFACT_BYTES) {
      throw new RangeError(`Journal artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`)
    }
    if (typeof artifact.digest !== "string" || !SHA256.test(artifact.digest)) {
      throw new TypeError("Journal artifact digest must be a lowercase SHA-256 digest")
    }
    const contentDigest = sha256Text(artifact.content)
    if (contentDigest !== artifact.digest) {
      throw new TurnJournalIntegrityError(
        `Journal artifact content does not match its declared digest ${artifact.digest}`,
      )
    }
    const recordedAt = Date.now()
    const digest = rowDigest("artifact", {
      digest: artifact.digest,
      kind: artifact.kind,
      turnId: artifact.turnId,
      contentDigest,
      byteLength,
    })
    const insert = this.database.transaction(() => {
      const existing = this.database
        .query("SELECT digest FROM agent_turn_artifacts WHERE digest = $digest")
        .get({ digest: artifact.digest }) as { digest: string } | null
      if (existing) return
      this.database.query(`
        INSERT INTO agent_turn_artifacts (digest, kind, turn_id, content, byte_length, recorded_at, row_digest)
        VALUES ($digest, $kind, $turnId, $content, $byteLength, $recordedAt, $rowDigest)
      `).run({
        digest: artifact.digest,
        kind: artifact.kind,
        turnId: artifact.turnId,
        content: artifact.content,
        byteLength,
        recordedAt,
        rowDigest: digest,
      })
    })
    insert.immediate()
  }

  recordModelCall(identity: ModelCallIdentity, response: ModelResponse): void {
    const normalized = normalizeModelResponse(response)
    const responseJson = boundedJson(modelResponseJson(normalized), "Journal model response")
    const modelIdentityJson = canonicalIdentityJson(componentIdentityJson(identity.modelIdentity))
    const modelJson = canonicalIdentityJson(modelDescriptorJson(identity.model))
    const recordedAt = Date.now()
    const digest = rowDigest("model-call", {
      turnId: identity.turnId,
      attempt: identity.attempt,
      requestDigest: identity.requestDigest,
      modelIdentity: componentIdentityJson(identity.modelIdentity),
      model: modelDescriptorJson(identity.model),
      responseDigest: sha256Text(responseJson),
    })
    const write = this.database.transaction(() => {
      const existing = this.#modelCallRow(identity.turnId, identity.attempt)
      if (existing) {
        this.#assertModelCallMatches(existing, identity)
        return
      }
      this.database.query(`
        INSERT INTO agent_model_calls (
          turn_id, attempt, request_digest, model_identity_json, model_json,
          response_json, recorded_at, row_digest
        ) VALUES (
          $turnId, $attempt, $requestDigest, $modelIdentityJson, $modelJson,
          $responseJson, $recordedAt, $rowDigest
        )
      `).run({
        turnId: identity.turnId,
        attempt: identity.attempt,
        requestDigest: identity.requestDigest,
        modelIdentityJson,
        modelJson,
        responseJson,
        recordedAt,
        rowDigest: digest,
      })
    })
    write.immediate()
  }

  recallModelCall(identity: ModelCallIdentity): ModelResponse | undefined {
    const row = this.#modelCallRow(identity.turnId, identity.attempt)
    if (!row) return undefined
    this.#assertModelCallMatches(row, identity)
    const stored = decodeRowJson(row.response_json, `Journal model response ${identity.turnId}/${identity.attempt}`)
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
      throw new TurnJournalIntegrityError(`Journal model response ${identity.turnId}/${identity.attempt} is malformed`)
    }
    const record = stored as Record<string, JsonValue>
    if (typeof record.text !== "string") {
      throw new TurnJournalIntegrityError(`Journal model response ${identity.turnId}/${identity.attempt} has no text`)
    }
    return normalizeModelResponse({
      text: record.text,
      ...(record.model === null || record.model === undefined
        ? {}
        : { model: record.model as unknown as ModelResponse["model"] }),
      ...(typeof record.finishReason === "string" ? { finishReason: record.finishReason } : {}),
      ...(record.metadata === null || record.metadata === undefined
        ? {}
        : { metadata: record.metadata as Record<string, JsonValue> }),
    })
  }

  recordHostCall(identity: HostCallIdentity, outcome: RecordedHostCall): void {
    const outputJson = outcome.outcome === "success"
      ? boundedJson(outcome.output, `Journal host call ${identity.functionName} output`)
      : null
    const errorJson = outcome.outcome === "failure"
      ? boundedJson(jsonSnapshot(outcome.error, "Journal host call error"), `Journal host call ${identity.functionName} error`)
      : null
    const recordedAt = Date.now()
    const digest = this.#hostCallDigest(identity, outcome.outcome, outputJson, errorJson)
    const write = this.database.transaction(() => {
      const existing = this.#hostCallRow(identity)
      if (existing) {
        this.#assertHostCallMatches(existing, identity)
        return
      }
      this.database.query(`
        INSERT INTO agent_host_calls (
          turn_id, source_digest, function_name, ordinal, call_id,
          function_identity_json, contract_json, input_digest, outcome,
          output_json, error_json, recorded_at, row_digest
        ) VALUES (
          $turnId, $sourceDigest, $functionName, $ordinal, $callId,
          $functionIdentityJson, $contractJson, $inputDigest, $outcome,
          $outputJson, $errorJson, $recordedAt, $rowDigest
        )
      `).run({
        turnId: identity.turnId,
        sourceDigest: identity.sourceDigest,
        functionName: identity.functionName,
        ordinal: identity.ordinal,
        callId: identity.callId,
        functionIdentityJson: canonicalIdentityJson(componentIdentityJson(identity.functionIdentity)),
        contractJson: canonicalIdentityJson(jsonSnapshot(identity.contract, "Journal host call contract")),
        inputDigest: identity.inputDigest,
        outcome: outcome.outcome,
        outputJson,
        errorJson,
        recordedAt,
        rowDigest: digest,
      })
    })
    write.immediate()
  }

  recallHostCall(identity: HostCallIdentity): RecordedHostCall | undefined {
    const row = this.#hostCallRow(identity)
    if (!row) return undefined
    this.#assertHostCallMatches(row, identity)
    return this.#hostCallOutcome(row)
  }

  /**
   * Attach one Flow call site to its durable execution, before the execution
   * runs. The row is keyed by the same call identity as a host call, so:
   *
   * - the first attempt commits the derived execution id;
   * - a replay of that call site re-reads it and reports `joined`, which is
   *   what makes a turn that crashed mid-Flow resume the *same* execution
   *   instead of starting a duplicate; and
   * - a replay with a different input, Plan, or execution id fails closed with
   *   `TurnJournalDivergenceError` before any durable work is started.
   */
  attachFlowCall(identity: FlowCallIdentity): FlowAttachment {
    if (typeof identity.executionId !== "string" || identity.executionId.trim() === "" ||
      identity.executionId.length > 256) {
      throw new TypeError("Journal flow call executionId must be a bounded non-empty string")
    }
    if (typeof identity.flowId !== "string" || identity.flowId.trim() === "" || identity.flowId.length > 256) {
      throw new TypeError("Journal flow call flowId must be a bounded non-empty string")
    }
    if (!Number.isSafeInteger(identity.flowVersion) || identity.flowVersion < 0) {
      throw new TypeError("Journal flow call flowVersion must be a non-negative safe integer")
    }
    if (!Number.isSafeInteger(identity.ordinal) || identity.ordinal < 1) {
      throw new TypeError("Journal flow call ordinal must be a positive safe integer")
    }
    if (!SHA256.test(identity.planDigest)) {
      throw new TypeError("Journal flow call planDigest must be a lowercase SHA-256 digest")
    }
    const recordedAt = Date.now()
    const attach = this.database.transaction((): FlowAttachment => {
      const existing = this.#flowCallRow(identity)
      if (existing) {
        this.#assertFlowCallMatches(existing, identity)
        return Object.freeze({
          executionId: existing.execution_id,
          attachment: "joined" as const,
          recordedAt: existing.recorded_at,
        })
      }
      this.database.query(`
        INSERT INTO agent_flow_calls (
          turn_id, source_digest, function_name, ordinal, execution_id,
          flow_id, flow_version, plan_digest, input_digest, recorded_at, row_digest
        ) VALUES (
          $turnId, $sourceDigest, $functionName, $ordinal, $executionId,
          $flowId, $flowVersion, $planDigest, $inputDigest, $recordedAt, $rowDigest
        )
      `).run({
        turnId: identity.turnId,
        sourceDigest: identity.sourceDigest,
        functionName: identity.functionName,
        ordinal: identity.ordinal,
        executionId: identity.executionId,
        flowId: identity.flowId,
        flowVersion: identity.flowVersion,
        planDigest: identity.planDigest,
        inputDigest: identity.inputDigest,
        recordedAt,
        rowDigest: this.#flowCallDigest(identity),
      })
      return Object.freeze({ executionId: identity.executionId, attachment: "started" as const, recordedAt })
    })
    return attach.immediate()
  }

  /** Digest-checked Flow attachments committed by this turn. */
  readFlowCalls(turnId: string): readonly StoredFlowCall[] {
    const rows = this.database
      .query("SELECT * FROM agent_flow_calls WHERE turn_id = $turnId ORDER BY function_name ASC, ordinal ASC")
      .all({ turnId }) as FlowCallRow[]
    return Object.freeze(rows.map((row) => {
      this.#assertFlowCallDigest(row)
      return Object.freeze({
        turnId: row.turn_id,
        sourceDigest: row.source_digest,
        functionName: row.function_name,
        ordinal: row.ordinal,
        executionId: row.execution_id,
        flowId: row.flow_id,
        flowVersion: row.flow_version,
        planDigest: row.plan_digest,
        inputDigest: row.input_digest,
        recordedAt: row.recorded_at,
      })
    }))
  }

  readArtifact(digest: string): JournalArtifact | undefined {
    const row = this.database
      .query("SELECT * FROM agent_turn_artifacts WHERE digest = $digest")
      .get({ digest }) as ArtifactRow | null
    if (!row) return undefined
    const contentDigest = sha256Text(row.content)
    const expected = rowDigest("artifact", {
      digest: row.digest,
      kind: row.kind,
      turnId: row.turn_id,
      contentDigest,
      byteLength: Buffer.byteLength(row.content, "utf8"),
    })
    if (expected !== row.row_digest || contentDigest !== row.digest) {
      throw new TurnJournalIntegrityError(`Journal artifact ${digest} failed persisted digest verification`)
    }
    return {
      kind: row.kind as JournalArtifact["kind"],
      turnId: row.turn_id,
      digest: row.digest,
      content: row.content,
    }
  }

  /** Digest-checked event history, including the append-order hash chain. */
  readEvents(turnId?: string): readonly StoredJournalEvent[] {
    const rows = this.database
      .query("SELECT * FROM agent_turn_events ORDER BY sequence ASC")
      .all() as EventRow[]
    const events: StoredJournalEvent[] = []
    let previousDigest = sha256Text(`${JOURNAL_SCHEMA}:genesis`)
    let expectedSequence = 1
    for (const row of rows) {
      const details = decodeRowJson(row.details_json, `Journal event ${row.sequence} details`)
      if (details === null || typeof details !== "object" || Array.isArray(details)) {
        throw new TurnJournalIntegrityError(`Journal event ${row.sequence} details are malformed`)
      }
      const digest = eventDigest(row.sequence, row.previous_digest, eventContent({
        turnId: row.turn_id,
        type: row.type,
        attempt: row.attempt,
        sourceDigest: row.source_digest,
        functionName: row.function_name,
        callId: row.call_id,
        ordinal: row.ordinal,
        ok: row.ok,
        details,
        recordedAt: row.recorded_at,
      }))
      if (digest !== row.event_digest) {
        throw new TurnJournalIntegrityError(`Journal event ${row.sequence} failed persisted digest verification`)
      }
      if (row.sequence !== expectedSequence || row.previous_digest !== previousDigest) {
        throw new TurnJournalIntegrityError(`Journal event ${row.sequence} broke the append-order hash chain`)
      }
      previousDigest = row.event_digest
      expectedSequence += 1
      if (turnId !== undefined && row.turn_id !== turnId) continue
      events.push(Object.freeze({
        sequence: row.sequence,
        turnId: row.turn_id,
        type: row.type as JournalEvent["type"],
        ...(row.attempt === null ? {} : { attempt: row.attempt }),
        ...(row.source_digest === null ? {} : { sourceDigest: row.source_digest }),
        ...(row.function_name === null ? {} : { functionName: row.function_name }),
        ...(row.call_id === null ? {} : { callId: row.call_id }),
        ...(row.ordinal === null ? {} : { ordinal: row.ordinal }),
        ...(row.ok === null ? {} : { ok: row.ok === 1 }),
        details: details as Record<string, JsonValue>,
        recordedAt: row.recorded_at,
      }))
    }
    return Object.freeze(events)
  }

  /** Digest-checked recorded host calls, in per-site ordinal order. */
  readHostCalls(turnId: string): readonly StoredHostCall[] {
    const rows = this.database
      .query("SELECT * FROM agent_host_calls WHERE turn_id = $turnId ORDER BY function_name ASC, ordinal ASC")
      .all({ turnId }) as HostCallRow[]
    return Object.freeze(rows.map((row) => {
      this.#assertHostCallDigest(row)
      return Object.freeze({
        turnId: row.turn_id,
        sourceDigest: row.source_digest,
        functionName: row.function_name,
        ordinal: row.ordinal,
        callId: row.call_id,
        inputDigest: row.input_digest,
        recordedAt: row.recorded_at,
        call: this.#hostCallOutcome(row),
      })
    }))
  }

  #modelCallRow(turnId: string, attempt: number): ModelCallRow | null {
    return this.database
      .query("SELECT * FROM agent_model_calls WHERE turn_id = $turnId AND attempt = $attempt")
      .get({ turnId, attempt }) as ModelCallRow | null
  }

  #assertModelCallMatches(row: ModelCallRow, identity: ModelCallIdentity): void {
    const responseDigest = sha256Text(row.response_json)
    const expected = rowDigest("model-call", {
      turnId: row.turn_id,
      attempt: row.attempt,
      requestDigest: row.request_digest,
      modelIdentity: decodeRowJson(row.model_identity_json, "Journal model identity"),
      model: decodeRowJson(row.model_json, "Journal model descriptor"),
      responseDigest,
    })
    if (expected !== row.row_digest) {
      throw new TurnJournalIntegrityError(
        `Journal model call ${row.turn_id}/${row.attempt} failed persisted digest verification`,
      )
    }
    const modelIdentity = canonicalIdentityJson(componentIdentityJson(identity.modelIdentity))
    const model = canonicalIdentityJson(modelDescriptorJson(identity.model))
    if (row.request_digest !== identity.requestDigest) {
      throw new TurnJournalDivergenceError(
        `Turn ${identity.turnId} attempt ${identity.attempt} replayed a different model request`,
      )
    }
    if (row.model_identity_json !== modelIdentity || row.model_json !== model) {
      throw new TurnJournalDivergenceError(
        `Turn ${identity.turnId} attempt ${identity.attempt} replayed under a different model identity`,
      )
    }
  }

  #hostCallRow(identity: HostCallIdentity): HostCallRow | null {
    return this.database.query(`
      SELECT * FROM agent_host_calls
      WHERE turn_id = $turnId AND source_digest = $sourceDigest
        AND function_name = $functionName AND ordinal = $ordinal
    `).get({
      turnId: identity.turnId,
      sourceDigest: identity.sourceDigest,
      functionName: identity.functionName,
      ordinal: identity.ordinal,
    }) as HostCallRow | null
  }

  #hostCallDigest(
    identity: HostCallIdentity,
    outcome: string,
    outputJson: string | null,
    errorJson: string | null,
  ): string {
    return rowDigest("host-call", {
      turnId: identity.turnId,
      sourceDigest: identity.sourceDigest,
      functionName: identity.functionName,
      ordinal: identity.ordinal,
      callId: identity.callId,
      functionIdentity: componentIdentityJson(identity.functionIdentity),
      contract: jsonSnapshot(identity.contract, "Journal host call contract"),
      inputDigest: identity.inputDigest,
      outcome,
      resultDigest: sha256Text(outputJson ?? errorJson ?? ""),
    })
  }

  #assertHostCallDigest(row: HostCallRow): void {
    const expected = rowDigest("host-call", {
      turnId: row.turn_id,
      sourceDigest: row.source_digest,
      functionName: row.function_name,
      ordinal: row.ordinal,
      callId: row.call_id,
      functionIdentity: decodeRowJson(row.function_identity_json, "Journal host call function identity"),
      contract: decodeRowJson(row.contract_json, "Journal host call contract"),
      inputDigest: row.input_digest,
      outcome: row.outcome,
      resultDigest: sha256Text(row.output_json ?? row.error_json ?? ""),
    })
    if (expected !== row.row_digest) {
      throw new TurnJournalIntegrityError(
        `Journal host call ${row.turn_id}/${row.function_name}#${row.ordinal} failed persisted digest verification`,
      )
    }
  }

  #assertHostCallMatches(row: HostCallRow, identity: HostCallIdentity): void {
    this.#assertHostCallDigest(row)
    if (row.input_digest !== identity.inputDigest) {
      throw new TurnJournalDivergenceError(
        `Replayed call ${identity.functionName}#${identity.ordinal} in turn ${identity.turnId} used a different input`,
      )
    }
    if (row.function_identity_json !== canonicalIdentityJson(componentIdentityJson(identity.functionIdentity))) {
      throw new TurnJournalDivergenceError(
        `Replayed call ${identity.functionName}#${identity.ordinal} in turn ${identity.turnId} used a different binding identity`,
      )
    }
    if (row.contract_json !== canonicalIdentityJson(jsonSnapshot(identity.contract, "Journal host call contract"))) {
      throw new TurnJournalDivergenceError(
        `Replayed call ${identity.functionName}#${identity.ordinal} in turn ${identity.turnId} used a different RPC contract`,
      )
    }
  }

  #flowCallRow(identity: FlowCallIdentity): FlowCallRow | null {
    return this.database.query(`
      SELECT * FROM agent_flow_calls
      WHERE turn_id = $turnId AND source_digest = $sourceDigest
        AND function_name = $functionName AND ordinal = $ordinal
    `).get({
      turnId: identity.turnId,
      sourceDigest: identity.sourceDigest,
      functionName: identity.functionName,
      ordinal: identity.ordinal,
    }) as FlowCallRow | null
  }

  #flowCallDigest(identity: FlowCallIdentity): string {
    return rowDigest("flow-call", {
      turnId: identity.turnId,
      sourceDigest: identity.sourceDigest,
      functionName: identity.functionName,
      ordinal: identity.ordinal,
      executionId: identity.executionId,
      flowId: identity.flowId,
      flowVersion: identity.flowVersion,
      planDigest: identity.planDigest,
      inputDigest: identity.inputDigest,
    })
  }

  #assertFlowCallDigest(row: FlowCallRow): void {
    const expected = rowDigest("flow-call", {
      turnId: row.turn_id,
      sourceDigest: row.source_digest,
      functionName: row.function_name,
      ordinal: row.ordinal,
      executionId: row.execution_id,
      flowId: row.flow_id,
      flowVersion: row.flow_version,
      planDigest: row.plan_digest,
      inputDigest: row.input_digest,
    })
    if (expected !== row.row_digest) {
      throw new TurnJournalIntegrityError(
        `Journal flow call ${row.turn_id}/${row.function_name}#${row.ordinal} failed persisted digest verification`,
      )
    }
  }

  #assertFlowCallMatches(row: FlowCallRow, identity: FlowCallIdentity): void {
    this.#assertFlowCallDigest(row)
    const site = `${identity.functionName}#${identity.ordinal} in turn ${identity.turnId}`
    if (row.input_digest !== identity.inputDigest) {
      throw new TurnJournalDivergenceError(`Replayed Flow call ${site} used a different input`)
    }
    if (row.plan_digest !== identity.planDigest || row.flow_id !== identity.flowId ||
      row.flow_version !== identity.flowVersion) {
      throw new TurnJournalDivergenceError(`Replayed Flow call ${site} used a different deployed Plan`)
    }
    if (row.execution_id !== identity.executionId) {
      throw new TurnJournalDivergenceError(`Replayed Flow call ${site} derived a different durable execution id`)
    }
  }

  #hostCallOutcome(row: HostCallRow): RecordedHostCall {
    const label = `Journal host call ${row.turn_id}/${row.function_name}#${row.ordinal}`
    if (row.outcome === "success") {
      if (row.output_json === null) throw new TurnJournalIntegrityError(`${label} recorded no output`)
      return Object.freeze({ outcome: "success" as const, output: decodeRowJson(row.output_json, `${label} output`) })
    }
    if (row.outcome !== "failure" || row.error_json === null) {
      throw new TurnJournalIntegrityError(`${label} has an unknown outcome`)
    }
    return Object.freeze({
      outcome: "failure" as const,
      error: serializedError(decodeRowJson(row.error_json, `${label} error`), `${label} error`),
    })
  }
}

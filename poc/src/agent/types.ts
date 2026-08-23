import type { ActionDescriptor, DurableSchema, StructuralDurableSchema } from "../durable/ir.ts"

export type Awaitable<T> = T | Promise<T>

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** Immutable replay identity for executable code plus behavior-affecting config. */
export interface ComponentIdentity {
  readonly name: string
  readonly artifactDigest: string
  readonly configDigest: string
}

export interface AgentMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface AgentDiagnostic {
  category: "error" | "warning" | "message"
  code?: number
  message: string
  file?: string
  line?: number
  column?: number
}

/**
 * Provider/model/version triple. It is separate from `ComponentIdentity`
 * because it is the human-meaningful deployment fact that the journal, the
 * turn provenance, and replay comparisons all quote.
 */
export interface ModelDescriptor {
  readonly provider: string
  readonly name: string
  readonly version: string
}

export interface ModelRequest {
  readonly turnId: string
  readonly messages: readonly AgentMessage[]
  readonly attempt: number
  readonly diagnostics: readonly AgentDiagnostic[]
  readonly callableSurface: string
}

export interface ModelResponse {
  /** Raw reply text. Source extraction is a separate, adapter-overridable step. */
  readonly text: string
  /** Version actually served, when the provider resolves it per request. */
  readonly model?: ModelDescriptor
  readonly finishReason?: string
  readonly metadata?: Record<string, JsonValue>
}

/**
 * The model boundary. A real provider client implements exactly this: an
 * identity that pins the adapter artifact and configuration, the served
 * model version, one request/response method, and an optional
 * provider-specific extraction of the TypeScript module from the reply.
 */
export interface ModelAdapter {
  readonly identity: ComponentIdentity
  readonly model: ModelDescriptor
  generate(request: ModelRequest): Awaitable<string | ModelResponse>
  /** Defaults to fenced-TypeScript extraction when the adapter omits it. */
  extractSource?(response: ModelResponse): string
}

/**
 * The compiler-derived wire contract of a durable Flow, projected from one
 * validated Plan artifact. It is the Flow-shaped peer of `ActionDescriptor`:
 * the Plan carries the Flow input/success/error schemas the durable executor
 * itself validates against, and `planDigest` pins the exact deployed Plan, so
 * a redeployed Flow is a different contract rather than a silent substitution.
 */
export interface FlowContract {
  readonly flowId: string
  readonly flowVersion: number
  /** Digest of the exact Plan template this binding starts or joins. */
  readonly planDigest: string
  /** Digest of identity, version, Plan digest, and the complete Flow schemas. */
  readonly contractDigest: string
  readonly inputSchema: StructuralDurableSchema
  readonly successSchema: StructuralDurableSchema
  /** Present when the Plan's Actions declare typed failures. */
  readonly errorSchema?: DurableSchema
}

/**
 * An explicitly passed host capability. `actionContract` and `flowContract`
 * are the checked compiler-derived paths; a signature without either is legacy
 * JSON-only interop.
 */
export interface AgentFunction<Input = JsonValue, Output = JsonValue> {
  readonly identity: ComponentIdentity
  readonly signature: string
  readonly description?: string
  /**
   * Optional compiler-derived wire contract. The sandbox validates the Action
   * input schema before host invocation and its success schema before replying.
   * Absence intentionally selects the weaker legacy JSON-only boundary.
   */
  readonly actionContract?: ActionDescriptor
  /**
   * Optional compiler-derived Flow contract. A binding carries at most one of
   * `actionContract`/`flowContract`; the sandbox validates the Flow input
   * schema before host invocation and its success schema before replying.
   */
  readonly flowContract?: FlowContract
  readonly invoke: (input: Input, context: AgentFunctionContext) => Awaitable<Output>
}

export interface AgentFunctionContext {
  /** Aborted when the generated turn times out or its sandbox process closes. */
  readonly signal: AbortSignal
  readonly turnId: string
  readonly sourceDigest: string
  readonly callId: number
  readonly functionName: string
  /**
   * Per-site ordinal: the nth call of this function name inside this turn's
   * accepted source. With the turn id and the accepted-source digest it is the
   * call-site identity a durable binding derives its execution id from.
   */
  readonly ordinal: number
  /** Digest of the validated call input, exactly as journaled. */
  readonly inputDigest: string
  /**
   * The turn journal, when the host attached one. A durable Flow binding needs
   * it to commit its execution attachment before starting work; an ordinary
   * tool never touches it.
   */
  readonly journal?: TurnJournal
}

export type AgentFunctionTable = Record<string, AgentFunction<any, any>>

export interface PromptRenderer<Input> {
  render(input: Input): Awaitable<readonly AgentMessage[]>
}

export interface CompilationResult {
  ok: boolean
  diagnostics: AgentDiagnostic[]
  javascript?: string
  compiler: string
}

export interface TypeScriptCompiler {
  readonly identity: ComponentIdentity
  compile(source: string, callableSurface: string): Promise<CompilationResult>
}

export interface ExecutionLog {
  level: "log" | "info" | "warn" | "error"
  values: JsonValue[]
}

export interface SandboxExecution {
  ok: boolean
  result?: JsonValue
  error?: SerializedError
  logs: ExecutionLog[]
  stderr: string
  durationMs: number
}

export interface SerializedError {
  name: string
  message: string
  stack?: string
  fields?: Record<string, JsonValue>
}

export interface SandboxExecuteOptions {
  sourceDigest: string
  journal?: TurnJournal
  turnId: string
  /** Optional caller cancellation; timeout remains an independent sandbox bound. */
  signal?: AbortSignal
}

export interface TypeScriptSandbox {
  readonly kind: string
  readonly identity: ComponentIdentity
  execute(
    javascript: string,
    functions: AgentFunctionTable,
    options: SandboxExecuteOptions,
  ): Promise<SandboxExecution>
}

export interface JournalEvent {
  type:
    | "turn.started"
    | "model.requested"
    | "model.responded"
    | "compile.completed"
    | "sandbox.started"
    | "function.called"
    | "flow.attached"
    | "function.completed"
    | "sandbox.completed"
    | "turn.completed"
  turnId: string
  attempt?: number
  sourceDigest?: string
  functionName?: string
  callId?: number
  /** Per-site ordinal of a host call inside the turn's accepted source. */
  ordinal?: number
  ok?: boolean
  details?: Record<string, JsonValue>
}

/**
 * Identity of one model invocation inside a turn. The turn id already folds in
 * the model identity and version, so a recorded response is only reused when
 * the attempt and the exact request digest also match.
 */
export interface ModelCallIdentity {
  readonly turnId: string
  readonly attempt: number
  readonly requestDigest: string
  readonly modelIdentity: ComponentIdentity
  readonly model: ModelDescriptor
}

/**
 * Identity of one host-function call. `ordinal` is the per-site ordinal — the
 * nth call of this function name within this turn's accepted source. The POC
 * keys the site by function name because no call-site information crosses the
 * sandbox RPC boundary (AGENT_LIBRARY.md open library decision 5).
 */
export interface HostCallIdentity {
  readonly turnId: string
  readonly sourceDigest: string
  readonly functionName: string
  readonly ordinal: number
  /** Sandbox transport id; recorded, but never part of the replay key. */
  readonly callId: number
  readonly functionIdentity: ComponentIdentity
  readonly contract: JsonValue
  readonly inputDigest: string
}

export type RecordedHostCall =
  | { readonly outcome: "success"; readonly output: JsonValue }
  | { readonly outcome: "failure"; readonly error: SerializedError }

/**
 * Identity of one durable Flow call issued by generated code. The execution id
 * is *derived*, not chosen: it is a pure function of the turn identity, the
 * accepted-source digest, the call site (function name plus per-site ordinal),
 * the deployed Plan digest, and the input digest. Replaying the same turn
 * therefore recomputes the same id and joins the same durable execution
 * instead of starting a second one.
 */
export interface FlowCallIdentity {
  readonly turnId: string
  readonly sourceDigest: string
  readonly functionName: string
  readonly ordinal: number
  readonly flowId: string
  readonly flowVersion: number
  readonly planDigest: string
  readonly inputDigest: string
  readonly executionId: string
}

/** The committed attachment of one call site to one durable execution. */
export interface FlowAttachment {
  readonly executionId: string
  /** `started` committed this attachment; `joined` re-read an existing one. */
  readonly attachment: "started" | "joined"
  readonly recordedAt: number
}

/**
 * Observation sink, plus an optional durable half. `append`/`putArtifact` are
 * the always-on observation seam. A journal that also implements the
 * recall/record pairs makes the turn replayable: the recorded model response
 * and the recorded results of completed Action calls are reused instead of
 * re-invoking the model or repeating host side effects.
 */
export interface TurnJournal {
  append(event: JournalEvent): Awaitable<void>
  putArtifact?(artifact: JournalArtifact): Awaitable<void>
  recallModelCall?(identity: ModelCallIdentity): Awaitable<ModelResponse | undefined>
  recordModelCall?(identity: ModelCallIdentity, response: ModelResponse): Awaitable<void>
  recallHostCall?(identity: HostCallIdentity): Awaitable<RecordedHostCall | undefined>
  recordHostCall?(identity: HostCallIdentity, outcome: RecordedHostCall): Awaitable<void>
  /**
   * Commit — or re-read — the durable execution a Flow call site is attached
   * to, before the execution is started. It is idempotent for an identical
   * identity and fails closed when the same call site is replayed against a
   * different input or a different deployed Plan.
   */
  attachFlowCall?(identity: FlowCallIdentity): Awaitable<FlowAttachment>
}

export interface JournalArtifact {
  kind: "generated-source" | "compiled-javascript"
  turnId: string
  digest: string
  content: string
}

export interface AgentAttempt {
  attempt: number
  source: string
  sourceDigest: string
  diagnostics: AgentDiagnostic[]
}

export interface AgentRunResult<Result extends JsonValue = JsonValue> {
  ok: boolean
  result?: Result
  error?: SerializedError
  diagnostics: AgentDiagnostic[]
  logs: ExecutionLog[]
  source?: string
  sourceDigest?: string
  attempts: AgentAttempt[]
  compiler?: string
  sandbox: string
  turnId: string
  provenance: TurnProvenance
}

export interface TurnProvenance {
  readonly schema: "smithers.agent.turn/v3"
  readonly promptDigest: string
  readonly callableDigest: string
  readonly functionTableDigest: string
  readonly agentConfigDigest: string
  readonly model: ComponentIdentity
  /** Provider/model/version; a version bump is a different turn, not a replay. */
  readonly modelVersion: ModelDescriptor
  readonly compiler: ComponentIdentity
  readonly sandbox: ComponentIdentity
  readonly functions: Readonly<Record<string, ComponentIdentity>>
}

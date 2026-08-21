export type Awaitable<T> = T | Promise<T>

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

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

export interface ModelRequest {
  messages: readonly AgentMessage[]
  attempt: number
  diagnostics: readonly AgentDiagnostic[]
  callableSurface: string
}

export interface ModelResponse {
  source: string
  provider?: string
  model?: string
  metadata?: Record<string, JsonValue>
}

export interface ModelAdapter {
  generate(request: ModelRequest): Awaitable<string | ModelResponse>
}

/**
 * Runtime JavaScript cannot recover erased TypeScript parameter and result
 * types. This explicit declaration is the temporary seam that a VibeLang
 * Action/Flow descriptor (and ultimately the compiler) should replace.
 */
export interface AgentFunction<Input = JsonValue, Output = JsonValue> {
  readonly signature: string
  readonly description?: string
  readonly invoke: (input: Input, context: AgentFunctionContext) => Awaitable<Output>
}

export interface AgentFunctionContext {
  /** Aborted when the generated turn times out or its sandbox process closes. */
  readonly signal: AbortSignal
  readonly turnId: string
  readonly sourceDigest: string
  readonly callId: number
  readonly functionName: string
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
}

export interface TypeScriptSandbox {
  readonly kind: string
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
    | "function.completed"
    | "sandbox.completed"
    | "turn.completed"
  turnId: string
  attempt?: number
  sourceDigest?: string
  functionName?: string
  callId?: number
  ok?: boolean
  details?: Record<string, JsonValue>
}

/** A durable adapter can persist these events; the POC itself is in-memory. */
export interface TurnJournal {
  append(event: JournalEvent): Awaitable<void>
  putArtifact?(artifact: JournalArtifact): Awaitable<void>
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
}

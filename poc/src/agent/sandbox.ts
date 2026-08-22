import { spawn, spawnSync } from "node:child_process"
import { realpathSync, statSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { once } from "node:events"
import type {
  AgentFunction,
  AgentFunctionContext,
  AgentFunctionTable,
  HostCallIdentity,
  JsonValue,
  SandboxExecuteOptions,
  SandboxExecution,
  SerializedError,
  TypeScriptSandbox,
} from "./types.ts"
import {
  agentFunctionContractIdentity,
  snapshotFunctionTable,
} from "./bindings.ts"
import { isDurableAgentFunction } from "./tools.ts"
import { validateDurableValue } from "../durable/schema.ts"
import {
  componentIdentityJson,
  defineComponentIdentity,
  sha256File,
  sha256Json,
} from "./identity.ts"

interface RunnerCall {
  type: "call"
  id: number
  name: string
  input: JsonValue
}

interface RunnerLog {
  type: "log"
  level: "log" | "info" | "warn" | "error"
  values: JsonValue[]
}

interface RunnerComplete {
  type: "complete"
  result: JsonValue
}

interface RunnerFailed {
  type: "failed"
  error: SerializedError
}

type RunnerMessage = RunnerCall | RunnerLog | RunnerComplete | RunnerFailed

interface PinnedFile {
  readonly path: string
  readonly digest: string
  readonly fingerprint: string
}

interface DenoRuntimePin extends PinnedFile {
  readonly denoVersion: string
  readonly v8Version: string
  readonly typescriptVersion: string
}

const DENO_RUNTIME_CACHE = new Map<string, DenoRuntimePin>()
const SANDBOX_PROTOCOL = 1
const MAX_AGENT_JSON_DEPTH = 128
const MAX_AGENT_JSON_NODES = 100_000
const MAX_SERIALIZED_ERROR_TEXT = 65_536
const MAX_SERIALIZED_ERROR_FIELDS = 256
/**
 * Control-plane outcomes. They describe how this process was torn down, not
 * what the host callback decided, so they are never committed as a replayable
 * result: a restarted turn must be free to call the function again.
 */
const NON_REPLAYABLE_FAILURES = new Set([
  "AbortError",
  "SandboxCancelled",
  "SandboxTimeout",
  "SandboxCallLimit",
  "SandboxOutputLimit",
  "SandboxTransportLimit",
  "SandboxChannelClosed",
  "SandboxClosed",
  "SandboxFailed",
  "SandboxSpawnError",
  "SandboxInitializationError",
  // A durable execution that lost its coordinator is still resumable: the
  // restarted turn must re-attach to the same execution id rather than be
  // answered from a recording of the interruption.
  "DurableFlowInterrupted",
  "CoordinatorCrash",
])

function fileFingerprint(path: string): string {
  const value = statSync(path, { bigint: true })
  // ctime closes the ordinary same-size + restored-mtime in-place rewrite
  // bypass. A digest is still checked whenever any filesystem identity bit
  // changes.
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":")
}

function pinFile(path: string): PinnedFile {
  const absolute = realpathSync(resolvePath(path))
  return Object.freeze({
    path: absolute,
    digest: sha256File(absolute),
    fingerprint: fileFingerprint(absolute),
  })
}

function pinDenoRuntime(requestedPath: string): DenoRuntimePin {
  const cached = DENO_RUNTIME_CACHE.get(requestedPath)
  if (cached) return cached
  const probe = spawnSync(requestedPath, [
    "eval",
    "--quiet",
    "console.log(JSON.stringify({execPath:Deno.execPath(),version:Deno.version}))",
  ], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  })
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `Unable to pin Deno runtime '${requestedPath}': ${probe.error?.message ?? probe.stderr.trim() ?? `exit ${probe.status}`}`,
    )
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(probe.stdout.trim())
  } catch {
    throw new Error(`Unable to pin Deno runtime '${requestedPath}': invalid identity probe output`)
  }
  const candidate = decoded as {
    execPath?: unknown
    version?: { deno?: unknown; v8?: unknown; typescript?: unknown }
  }
  if (
    typeof candidate.execPath !== "string" ||
    typeof candidate.version?.deno !== "string" ||
    typeof candidate.version.v8 !== "string" ||
    typeof candidate.version.typescript !== "string"
  ) {
    throw new Error(`Unable to pin Deno runtime '${requestedPath}': incomplete identity probe`)
  }
  const file = pinFile(candidate.execPath)
  const result = Object.freeze({
    ...file,
    denoVersion: candidate.version.deno,
    v8Version: candidate.version.v8,
    typescriptVersion: candidate.version.typescript,
  })
  DENO_RUNTIME_CACHE.set(requestedPath, result)
  return result
}

function verifyPinnedFile(file: PinnedFile, label: string): void {
  let fingerprint: string
  try {
    fingerprint = fileFingerprint(file.path)
  } catch (error) {
    throw new Error(`${label} disappeared after identity pinning: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (fingerprint !== file.fingerprint && sha256File(file.path) !== file.digest) {
    throw new Error(`${label} changed after identity pinning`)
  }
}

function denoRunArguments(memoryMb: number, runnerPath: string): string[] {
  return [
    "run",
    "--quiet",
    "--no-prompt",
    "--no-config",
    "--no-lock",
    "--no-npm",
    `--v8-flags=--max-old-space-size=${memoryMb},--disallow-code-generation-from-strings`,
    "--deny-read",
    "--deny-write",
    "--deny-net",
    "--deny-env",
    "--deny-run",
    "--deny-sys",
    "--deny-ffi",
    "--deny-import",
    runnerPath,
  ]
}

interface AgentJsonBudget {
  nodes: number
}

function jsonValue(
  value: unknown,
  path = "Agent boundary value",
  seen = new Set<object>(),
  depth = 0,
  budget: AgentJsonBudget = { nodes: 0 },
): JsonValue {
  if (depth > MAX_AGENT_JSON_DEPTH) throw new TypeError(`${path} is not JSON: nesting limit exceeded`)
  if (++budget.nodes > MAX_AGENT_JSON_NODES) throw new TypeError(`${path} is not JSON: node limit exceeded`)
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not JSON: non-finite number`)
    return value
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not JSON: ${typeof value}`)
  if (seen.has(value)) throw new TypeError(`${path} is not JSON: cyclic value`)

  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new TypeError(`${path} is not JSON: exotic array`)
    const ownKeys = Reflect.ownKeys(value)
    for (const key of ownKeys) {
      if (key === "length") continue
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
        throw new TypeError(`${path} is not JSON: unsupported array property ${String(key)}`)
      }
    }
    seen.add(value)
    try {
      const output: JsonValue[] = []
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is not JSON: array hole`)
        output.push(jsonValue(value[index], `${path}[${index}]`, seen, depth + 1, budget))
      }
      return output
    } finally {
      seen.delete(value)
    }
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} is not JSON: ${prototype?.constructor?.name ?? "exotic object"}`)
  }
  seen.add(value)
  try {
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${path} is not JSON: symbol property`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        throw new TypeError(`${path}.${key} is not JSON: accessor or non-enumerable property`)
      }
      output[key] = jsonValue(descriptor.value, `${path}.${key}`, seen, depth + 1, budget)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

function boundedText(value: unknown, fallback: string): string {
  try {
    return String(value).slice(0, MAX_SERIALIZED_ERROR_TEXT)
  } catch {
    return fallback
  }
}

function errorDataProperty(value: object, key: PropertyKey): unknown {
  try {
    const own = Object.getOwnPropertyDescriptor(value, key)
    if (own && "value" in own) return own.value
    const prototype = Object.getPrototypeOf(value)
    const inherited = prototype && Object.getOwnPropertyDescriptor(prototype, key)
    return inherited && "value" in inherited ? inherited.value : undefined
  } catch {
    return undefined
  }
}

function serializeError(error: unknown): SerializedError {
  const object = error !== null && (typeof error === "object" || typeof error === "function")
    ? error as object
    : undefined
  const name = boundedText(object ? errorDataProperty(object, "name") ?? "Error" : "Error", "Error") || "Error"
  const message = boundedText(
    object ? errorDataProperty(object, "message") ?? error : error,
    "Unserializable thrown value",
  )
  const rawStack = object ? errorDataProperty(object, "stack") : undefined
  const stack = rawStack === undefined ? undefined : boundedText(rawStack, "")
  const fields = Object.create(null) as Record<string, JsonValue>
  if (object) {
    let keys: PropertyKey[] = []
    try { keys = Reflect.ownKeys(object).slice(0, MAX_SERIALIZED_ERROR_FIELDS) } catch { /* hostile proxy */ }
    for (const key of keys) {
      if (typeof key !== "string" || key.length > 1_024 || ["name", "message", "stack"].includes(key)) continue
      let item: unknown
      try {
        const descriptor = Object.getOwnPropertyDescriptor(object, key)
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) continue
        item = descriptor.value
      } catch {
        continue
      }
      try {
        fields[key] = jsonValue(item, `Error field ${key}`)
      } catch {
        fields[key] = boundedText(item, "[unserializable]")
      }
    }
  }
  return { name, message, ...(stack === undefined ? {} : { stack }), fields }
}

class AgentRpcContractError extends Error {
  readonly phase: "input" | "output"
  readonly contractDigest: string
  readonly schemaDigest: string

  constructor(
    functionName: string,
    phase: "input" | "output",
    contractDigest: string,
    schemaDigest: string,
    cause: unknown,
  ) {
    super(
      `${functionName} ${phase} violated compiler-derived RPC contract ${contractDigest}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = "AgentRpcContractError"
    this.phase = phase
    this.contractDigest = contractDigest
    this.schemaDigest = schemaDigest
  }
}

function validateFunctionContract(
  binding: AgentFunction<any, any>,
  phase: "input" | "output",
  value: JsonValue,
  functionName: string,
): JsonValue {
  // A Flow binding is checked against the same compiler-derived Flow schemas
  // the durable executor validates against, so an invalid call is rejected at
  // the RPC boundary before any durable execution is started or joined.
  const contract = binding.actionContract ?? binding.flowContract
  if (contract === undefined) return value
  const schema = phase === "input" ? contract.inputSchema : contract.successSchema
  try {
    return validateDurableValue(schema, value, `${functionName} ${phase}`) as JsonValue
  } catch (error) {
    throw new AgentRpcContractError(
      functionName,
      phase,
      contract.contractDigest,
      schema.digest,
      error,
    )
  }
}

function cancelledError(reason: unknown): SerializedError {
  return {
    name: "SandboxCancelled",
    message: reason === undefined
      ? "Sandbox execution was cancelled"
      : serializeError(reason).message,
  }
}

function abortError(signal: AbortSignal): Error {
  try {
    if (signal.reason instanceof Error) return signal.reason
  } catch { /* hostile cancellation reason */ }
  const error = new Error(signal.reason === undefined
    ? "Sandbox host call aborted"
    : boundedText(signal.reason, "Sandbox host call aborted"))
  error.name = "AbortError"
  return error
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal))
    signal.addEventListener("abort", onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

export interface DenoSubprocessSandboxOptions {
  denoPath?: string
  runnerPath?: string
  timeoutMs?: number
  memoryMb?: number
  /** Maximum generated JavaScript bytes accepted before base64 transport. */
  maxSourceBytes?: number
  maxOutputBytes?: number
  maxCalls?: number
  maxConcurrentCalls?: number
}

/**
 * POC confinement: a fresh Deno process with explicit deny flags plus hidden
 * host globals. Functions with an Action contract use compiler-derived
 * structural codecs; legacy bindings retain an explicitly weaker JSON-only
 * compatibility path.
 */
export class DenoSubprocessSandbox implements TypeScriptSandbox {
  readonly kind = "deno-subprocess/no-permissions"
  readonly identity
  readonly #denoPath: string
  readonly #runnerPath: string
  readonly #runtimePin: DenoRuntimePin
  readonly #runnerPin: PinnedFile
  readonly #timeoutMs: number
  readonly #memoryMb: number
  readonly #maxSourceBytes: number
  readonly #maxOutputBytes: number
  readonly #maxCalls: number
  readonly #maxConcurrentCalls: number

  constructor(options: DenoSubprocessSandboxOptions = {}) {
    this.#runtimePin = pinDenoRuntime(options.denoPath ?? "deno")
    this.#denoPath = this.#runtimePin.path
    this.#runnerPath = resolvePath(
      options.runnerPath ?? fileURLToPath(new URL("./deno-runner.js", import.meta.url)),
    )
    this.#runnerPin = pinFile(this.#runnerPath)
    this.#timeoutMs = options.timeoutMs ?? 30_000
    this.#memoryMb = options.memoryMb ?? 128
    this.#maxSourceBytes = options.maxSourceBytes ?? 512 * 1024
    this.#maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
    this.#maxCalls = options.maxCalls ?? 1_000
    this.#maxConcurrentCalls = options.maxConcurrentCalls ?? 32
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 300_000) {
      throw new RangeError("Sandbox timeoutMs must be between 1 and 300000")
    }
    if (!Number.isSafeInteger(this.#memoryMb) || this.#memoryMb < 16 || this.#memoryMb > 4096) {
      throw new RangeError("Sandbox memoryMb must be between 16 and 4096")
    }
    if (!Number.isSafeInteger(this.#maxSourceBytes) || this.#maxSourceBytes < 1024 || this.#maxSourceBytes > 16 * 1024 * 1024) {
      throw new RangeError("Sandbox maxSourceBytes must be between 1024 and 16777216")
    }
    if (!Number.isSafeInteger(this.#maxOutputBytes) || this.#maxOutputBytes < 1024) {
      throw new RangeError("Sandbox maxOutputBytes must be at least 1024")
    }
    if (!Number.isSafeInteger(this.#maxCalls) || this.#maxCalls < 1) {
      throw new RangeError("Sandbox maxCalls must be a positive safe integer")
    }
    if (!Number.isSafeInteger(this.#maxConcurrentCalls) || this.#maxConcurrentCalls < 1) {
      throw new RangeError("Sandbox maxConcurrentCalls must be a positive safe integer")
    }
    this.identity = defineComponentIdentity({
      name: this.kind,
      artifactDigest: sha256Json({
        denoBinaryDigest: this.#runtimePin.digest,
        denoVersion: this.#runtimePin.denoVersion,
        v8Version: this.#runtimePin.v8Version,
        typescriptVersion: this.#runtimePin.typescriptVersion,
        runnerDigest: this.#runnerPin.digest,
      }),
      configDigest: sha256Json({
        schema: "vibelang.agent.deno-sandbox/v1",
        protocol: SANDBOX_PROTOCOL,
        arguments: denoRunArguments(this.#memoryMb, "<pinned-runner>"),
        timeoutMs: this.#timeoutMs,
        memoryMb: this.#memoryMb,
        maxSourceBytes: this.#maxSourceBytes,
        maxOutputBytes: this.#maxOutputBytes,
        maxCalls: this.#maxCalls,
        maxConcurrentCalls: this.#maxConcurrentCalls,
      }),
    })
  }

  execute(
    javascript: string,
    functions: AgentFunctionTable,
    options: SandboxExecuteOptions,
  ): Promise<SandboxExecution> {
    const started = Date.now()
    if (typeof javascript !== "string" || Buffer.byteLength(javascript, "utf8") > this.#maxSourceBytes) {
      return Promise.resolve({
        ok: false,
        error: {
          name: "SandboxInputLimit",
          message: `Generated JavaScript must be a string no larger than ${this.#maxSourceBytes} UTF-8 bytes`,
        },
        logs: [],
        stderr: "",
        durationMs: 0,
      })
    }
    if (options.signal?.aborted) {
      return Promise.resolve({
        ok: false,
        error: cancelledError(options.signal.reason),
        logs: [],
        stderr: "",
        durationMs: 0,
      })
    }
    let stableFunctions: AgentFunctionTable
    try {
      verifyPinnedFile(this.#runtimePin, "Deno runtime")
      verifyPinnedFile(this.#runnerPin, "Deno sandbox runner")
      stableFunctions = snapshotFunctionTable(functions)
    } catch (error) {
      return Promise.resolve({
        ok: false,
        error: serializeError(error),
        logs: [],
        stderr: "",
        durationMs: Date.now() - started,
      })
    }
    if (options.signal?.aborted) {
      return Promise.resolve({
        ok: false,
        error: cancelledError(options.signal.reason),
        logs: [],
        stderr: "",
        durationMs: Date.now() - started,
      })
    }
    const encodedSource = Buffer.from(javascript, "utf8").toString("base64")
    const functionNames = Object.keys(stableFunctions)

    return new Promise((resolve) => {
      const child = spawn(
        this.#denoPath,
        denoRunArguments(this.#memoryMb, this.#runnerPath),
        { stdio: ["pipe", "pipe", "pipe"] },
      )

      const logs: SandboxExecution["logs"] = []
      let stderr = ""
      let terminal: RunnerComplete | RunnerFailed | undefined
      let timedOut = false
      let outputLimited = false
      let outputBytes = 0
      let transportBytes = 0
      let callCount = 0
      let settled = false
      let channelOpen = true
      let policyFailure: SerializedError | undefined
      // Per-site ordinals: the nth call of this function name inside this
      // turn's accepted source. Assigned in protocol arrival order, which is
      // the order the generated program issued the calls.
      const ordinals = new Map<string, number>()
      const hostCalls = new Map<number, Promise<void>>()
      const hostAbort = new AbortController()
      let writeTail: Promise<boolean> = Promise.resolve(true)

      const abortHostCalls = (name: string, message: string): void => {
        if (hostAbort.signal.aborted) return
        const error = new Error(message)
        error.name = name
        hostAbort.abort(error)
      }

      const onExternalAbort = (): void => {
        policyFailure = cancelledError(options.signal?.reason)
        abortHostCalls(policyFailure.name, policyFailure.message)
        child.kill("SIGKILL")
      }
      options.signal?.addEventListener("abort", onExternalAbort, { once: true })
      if (options.signal?.aborted) onExternalAbort()

      const writeResponse = (message: unknown): Promise<boolean> => {
        const line = `${JSON.stringify(message)}\n`
        transportBytes += Buffer.byteLength(line)
        if (transportBytes > this.#maxOutputBytes) {
          policyFailure = {
            name: "SandboxTransportLimit",
            message: `Sandbox RPC exceeded ${this.#maxOutputBytes} bytes`,
          }
          abortHostCalls(policyFailure.name, policyFailure.message)
          child.kill("SIGKILL")
          return Promise.resolve(false)
        }
        writeTail = writeTail.then(async () => {
          if (hostAbort.signal.aborted || !channelOpen || child.stdin.destroyed || !child.stdin.writable) {
            return false
          }
          try {
            if (!child.stdin.write(line)) await once(child.stdin, "drain")
            return true
          } catch {
            channelOpen = false
            abortHostCalls("SandboxChannelClosed", "Sandbox RPC response channel closed")
            return false
          }
        })
        return writeTail
      }

      child.stdin.on("error", () => {
        channelOpen = false
        abortHostCalls("SandboxChannelClosed", "Sandbox RPC response channel closed")
      })

      void writeResponse({
        type: "init",
        protocol: SANDBOX_PROTOCOL,
        sourceBase64: encodedSource,
        functionNames,
      }).catch((error: unknown) => {
        policyFailure = serializeError(error)
        abortHostCalls("SandboxInitializationError", "Sandbox initialization failed")
        child.kill("SIGKILL")
      })

      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk) => {
        outputBytes += Buffer.byteLength(chunk)
        if (stderr.length < this.#maxOutputBytes) stderr += chunk
        if (outputBytes > this.#maxOutputBytes) {
          outputLimited = true
          abortHostCalls("SandboxOutputLimit", "Sandbox output limit exceeded")
          child.kill("SIGKILL")
        }
      })

      // Raw stdout accounting mirrors the stderr path: bytes are counted as
      // they arrive from the OS pipe, before readline assembles a full line.
      // A hostile turn can emit a single protocol line far larger than
      // #maxOutputBytes (JSON.stringify escapes any embedded newlines, so the
      // terminating "\n" only arrives after the whole payload), which the old
      // per-line check let readline buffer host-side up to the child's V8 heap
      // cap before firing. Counting at the byte layer bounds that host-memory
      // DoS. This is the sole stdout counter — the line consumer never counts
      // again — so the effective limit is not halved, and stderr keeps adding
      // into the same shared #maxOutputBytes budget exactly as before.
      child.stdout.on("data", (chunk) => {
        outputBytes += Buffer.byteLength(chunk)
        if (outputBytes > this.#maxOutputBytes && !outputLimited) {
          outputLimited = true
          abortHostCalls("SandboxOutputLimit", "Sandbox output limit exceeded")
          child.kill("SIGKILL")
        }
      })

      const lines = createInterface({ input: child.stdout })
      lines.on("line", (line) => {
        if (outputLimited) return
        let message: RunnerMessage
        try {
          const decoded = JSON.parse(line) as unknown
          if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
            throw new TypeError("protocol message must be an object")
          }
          message = decoded as RunnerMessage
        } catch {
          policyFailure = { name: "SandboxProtocolError", message: "Sandbox emitted invalid JSON protocol output" }
          abortHostCalls(policyFailure.name, policyFailure.message)
          child.kill("SIGKILL")
          return
        }

        if (message.type === "log") {
          try {
            const values = jsonValue(message.values, "Sandbox log values")
            if (!Array.isArray(values) || !["log", "info", "warn", "error"].includes(message.level)) {
              throw new TypeError("invalid sandbox log")
            }
            logs.push({ level: message.level, values })
          } catch (error) {
            stderr += `Invalid sandbox log: ${error instanceof Error ? error.message : String(error)}\n`
          }
          return
        }
        if (message.type === "complete") {
          if (terminal) {
            policyFailure = { name: "SandboxProtocolError", message: "Sandbox emitted multiple terminal messages" }
            abortHostCalls(policyFailure.name, policyFailure.message)
            child.kill("SIGKILL")
            return
          }
          try {
            terminal = { type: "complete", result: jsonValue(message.result, "Sandbox turn result") }
          } catch (error) {
            terminal = { type: "failed", error: serializeError(error) }
          }
          return
        }
        if (message.type === "failed") {
          if (terminal) {
            policyFailure = { name: "SandboxProtocolError", message: "Sandbox emitted multiple terminal messages" }
            abortHostCalls(policyFailure.name, policyFailure.message)
            child.kill("SIGKILL")
            return
          }
          terminal = message
          abortHostCalls("SandboxFailed", "Sandbox turn failed while host calls were active")
          return
        }
        if (message.type === "call") {
          if (!Number.isSafeInteger(message.id) || message.id < 1 || typeof message.name !== "string") {
            policyFailure = { name: "SandboxProtocolError", message: "Sandbox emitted an invalid call message" }
            abortHostCalls(policyFailure.name, policyFailure.message)
            child.kill("SIGKILL")
            return
          }
          if (hostCalls.has(message.id)) {
            policyFailure = { name: "SandboxProtocolError", message: `Duplicate sandbox call id: ${message.id}` }
            abortHostCalls(policyFailure.name, policyFailure.message)
            child.kill("SIGKILL")
            return
          }
          callCount++
          if (callCount > this.#maxCalls || hostCalls.size >= this.#maxConcurrentCalls) {
            policyFailure = {
              name: "SandboxCallLimit",
              message: callCount > this.#maxCalls
                ? `Generated turn exceeded ${this.#maxCalls} host calls`
                : `Generated turn exceeded ${this.#maxConcurrentCalls} concurrent host calls`,
            }
            abortHostCalls(policyFailure.name, policyFailure.message)
            child.kill("SIGKILL")
            return
          }
          const ordinal = (ordinals.get(message.name) ?? 0) + 1
          ordinals.set(message.name, ordinal)
          const call = this.#handleCall(
            message,
            ordinal,
            stableFunctions,
            options,
            hostAbort.signal,
            writeResponse,
          )
          hostCalls.set(message.id, call)
          void call.finally(() => hostCalls.delete(message.id))
          return
        }
        policyFailure = { name: "SandboxProtocolError", message: "Sandbox emitted an unknown protocol message" }
        abortHostCalls(policyFailure.name, policyFailure.message)
        child.kill("SIGKILL")
      })

      const timer = setTimeout(() => {
        timedOut = true
        abortHostCalls("SandboxTimeout", `Generated turn exceeded ${this.#timeoutMs}ms`)
        child.kill("SIGKILL")
      }, this.#timeoutMs)

      child.on("error", (error) => {
        if (settled) return
        settled = true
        channelOpen = false
        abortHostCalls("SandboxSpawnError", "Sandbox process failed to start")
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", onExternalAbort)
        resolve({
          ok: false,
          error: serializeError(error),
          logs,
          stderr,
          durationMs: Date.now() - started,
        })
      })

      child.on("close", () => {
        if (settled) return
        settled = true
        channelOpen = false
        abortHostCalls("SandboxClosed", "Sandbox process closed")
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", onExternalAbort)
        if (outputLimited) {
          resolve({
            ok: false,
            error: {
              name: "SandboxOutputLimit",
              message: `Generated turn exceeded ${this.#maxOutputBytes} output bytes`,
            },
            logs,
            stderr,
            durationMs: Date.now() - started,
          })
          return
        }
        if (policyFailure) {
          resolve({
            ok: false,
            error: policyFailure,
            logs,
            stderr,
            durationMs: Date.now() - started,
          })
          return
        }
        if (timedOut) {
          resolve({
            ok: false,
            error: {
              name: "SandboxTimeout",
              message: `Generated turn exceeded ${this.#timeoutMs}ms`,
            },
            logs,
            stderr,
            durationMs: Date.now() - started,
          })
          return
        }
        if (terminal?.type === "complete") {
          resolve({
            ok: true,
            result: terminal.result,
            logs,
            stderr,
            durationMs: Date.now() - started,
          })
          return
        }
        resolve({
          ok: false,
          error:
            terminal?.type === "failed"
              ? terminal.error
              : { name: "SandboxProtocolError", message: "Sandbox exited without a result" },
          logs,
          stderr,
          durationMs: Date.now() - started,
        })
      })
    })
  }

  async #handleCall(
    call: RunnerCall,
    ordinal: number,
    functions: AgentFunctionTable,
    options: SandboxExecuteOptions,
    signal: AbortSignal,
    writeResponse: (message: unknown) => Promise<boolean>,
  ): Promise<void> {
    const binding = Object.hasOwn(functions, call.name) ? functions[call.name] : undefined
    const journal = options.journal
    // Durable semantics belong to Action and Flow calls; a legacy JSON-only
    // closure is journaled as an observation but never replayed.
    const durable = binding !== undefined && isDurableAgentFunction(binding) && journal !== undefined
    const recall = durable && typeof journal.recallHostCall === "function"
      ? journal.recallHostCall.bind(journal)
      : undefined
    const record = durable && typeof journal.recordHostCall === "function"
      ? journal.recordHostCall.bind(journal)
      : undefined
    let identity: HostCallIdentity | undefined
    try {
      if (!binding) throw new Error(`Generated code requested unknown function: ${call.name}`)
      if (signal.aborted) throw abortError(signal)
      const transportedInput = jsonValue(call.input, `${call.name} input`)
      const journalInput = jsonValue(transportedInput, `${call.name} journal input`)
      const inputDigest = sha256Json(journalInput)
      identity = Object.freeze({
        turnId: options.turnId,
        sourceDigest: options.sourceDigest,
        functionName: call.name,
        ordinal,
        callId: call.id,
        functionIdentity: binding.identity,
        contract: agentFunctionContractIdentity(binding),
        inputDigest,
      })
      await journal?.append({
        type: "function.called",
        turnId: options.turnId,
        sourceDigest: options.sourceDigest,
        functionName: call.name,
        callId: call.id,
        ordinal,
        details: {
          input: journalInput,
          inputDigest,
          durable: isDurableAgentFunction(binding),
          functionIdentity: componentIdentityJson(binding.identity),
          rpcContract: agentFunctionContractIdentity(binding),
        },
      })
      const input = validateFunctionContract(binding, "input", transportedInput, call.name)
      if (signal.aborted) throw abortError(signal)

      // A completed call recorded under this identity is returned without
      // re-invoking the host, and is revalidated against the contract before
      // it re-enters the sandbox so a corrupted or drifted recording cannot
      // bypass the codec.
      if (recall !== undefined && record !== undefined) {
        const recorded = await recall(identity)
        if (recorded !== undefined) {
          if (recorded.outcome === "failure") {
            await this.#journalCompletion(journal, identity, false, "replay", recorded.error.message)
            await writeResponse({ id: call.id, ok: false, error: recorded.error })
            return
          }
          const replayedResult = validateFunctionContract(binding, "output", recorded.output, call.name)
          await this.#journalCompletion(journal, identity, true, "replay")
          await writeResponse({ id: call.id, ok: true, result: replayedResult })
          return
        }
      }

      const context: AgentFunctionContext = {
        signal,
        turnId: options.turnId,
        sourceDigest: options.sourceDigest,
        functionName: call.name,
        callId: call.id,
        ordinal,
        inputDigest,
        ...(journal === undefined ? {} : { journal }),
      }
      const invoked = Promise.resolve(binding.invoke(input, context))
      const transportedResult = jsonValue(
        await abortable(invoked, signal),
        `${call.name} result`,
      )
      const result = validateFunctionContract(binding, "output", transportedResult, call.name)
      // Commit before the generated program can observe the result: a restart
      // between the effect and its record must not repeat the side effect.
      if (record !== undefined) await record(identity, { outcome: "success", output: result })
      await this.#journalCompletion(journal, identity, true, "live")
      await writeResponse({ id: call.id, ok: true, result })
    } catch (error) {
      const serialized = serializeError(error)
      try {
        if (record !== undefined && identity !== undefined && !NON_REPLAYABLE_FAILURES.has(serialized.name)) {
          await record(identity, { outcome: "failure", error: serialized })
        }
      } catch {
        // A journal write failure must not strand the generated call.
      }
      try {
        await journal?.append({
          type: "function.completed",
          turnId: options.turnId,
          sourceDigest: options.sourceDigest,
          functionName: call.name,
          callId: call.id,
          ordinal,
          ok: false,
          details: {
            source: "live",
            error: serialized.message,
            errorName: serialized.name,
            ...(binding ? {
              functionIdentity: componentIdentityJson(binding.identity),
              rpcContract: agentFunctionContractIdentity(binding),
            } : {}),
          },
        })
      } catch {
        // The function response still closes even if an observation sink fails.
      }
      await writeResponse({ id: call.id, ok: false, error: serialized })
    }
  }

  async #journalCompletion(
    journal: SandboxExecuteOptions["journal"],
    identity: HostCallIdentity,
    ok: boolean,
    source: "live" | "replay",
    error?: string,
  ): Promise<void> {
    await journal?.append({
      type: "function.completed",
      turnId: identity.turnId,
      sourceDigest: identity.sourceDigest,
      functionName: identity.functionName,
      callId: identity.callId,
      ordinal: identity.ordinal,
      ok,
      details: {
        source,
        ...(error === undefined ? {} : { error }),
        functionIdentity: componentIdentityJson(identity.functionIdentity),
        rpcContract: identity.contract,
      },
    })
  }
}

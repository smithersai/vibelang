import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import type {
  AgentFunctionContext,
  AgentFunctionTable,
  JsonValue,
  SandboxExecuteOptions,
  SandboxExecution,
  SerializedError,
  TypeScriptSandbox,
} from "./types.ts"

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

function jsonValue(value: unknown, path = "Agent boundary value", seen = new Set<object>()): JsonValue {
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
        output.push(jsonValue(value[index], `${path}[${index}]`, seen))
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
      output[key] = jsonValue(descriptor.value, `${path}.${key}`, seen)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

function serializeError(error: unknown): SerializedError {
  const value = error instanceof Error ? error : new Error(String(error))
  const fields: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    try {
      fields[key] = jsonValue(item, `Error field ${key}`)
    } catch {
      fields[key] = String(item)
    }
  }
  return { name: value.name, message: value.message, stack: value.stack, fields }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error(signal.reason === undefined ? "Sandbox host call aborted" : String(signal.reason))
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
  maxOutputBytes?: number
}

/**
 * POC confinement: a fresh Deno process with explicit deny flags plus hidden
 * host globals. JSON is a deliberate stand-in for compiler-derived codecs.
 */
export class DenoSubprocessSandbox implements TypeScriptSandbox {
  readonly kind = "deno-subprocess/no-permissions"
  readonly #denoPath: string
  readonly #runnerPath: string
  readonly #timeoutMs: number
  readonly #memoryMb: number
  readonly #maxOutputBytes: number

  constructor(options: DenoSubprocessSandboxOptions = {}) {
    this.#denoPath = options.denoPath ?? "deno"
    this.#runnerPath =
      options.runnerPath ?? fileURLToPath(new URL("./deno-runner.js", import.meta.url))
    this.#timeoutMs = options.timeoutMs ?? 30_000
    this.#memoryMb = options.memoryMb ?? 128
    this.#maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
    if (this.#memoryMb < 16) throw new RangeError("Sandbox memoryMb must be at least 16")
  }

  execute(
    javascript: string,
    functions: AgentFunctionTable,
    options: SandboxExecuteOptions,
  ): Promise<SandboxExecution> {
    const started = Date.now()
    const encodedSource = Buffer.from(javascript, "utf8").toString("base64")
    const functionNames = JSON.stringify(Object.keys(functions))

    return new Promise((resolve) => {
      const child = spawn(
        this.#denoPath,
        [
          "run",
          "--quiet",
          "--no-prompt",
          "--no-config",
          "--no-lock",
          "--no-npm",
          `--v8-flags=--max-old-space-size=${this.#memoryMb},--disallow-code-generation-from-strings`,
          "--deny-read",
          "--deny-write",
          "--deny-net",
          "--deny-env",
          "--deny-run",
          "--deny-sys",
          "--deny-ffi",
          "--deny-import",
          this.#runnerPath,
          encodedSource,
          functionNames,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      )

      const logs: SandboxExecution["logs"] = []
      let stderr = ""
      let terminal: RunnerComplete | RunnerFailed | undefined
      let timedOut = false
      let outputLimited = false
      let outputBytes = 0
      let settled = false
      let channelOpen = true
      const hostCalls = new Map<number, Promise<void>>()
      const hostAbort = new AbortController()

      const abortHostCalls = (name: string, message: string): void => {
        if (hostAbort.signal.aborted) return
        const error = new Error(message)
        error.name = name
        hostAbort.abort(error)
      }

      const writeResponse = (message: unknown): boolean => {
        if (hostAbort.signal.aborted || !channelOpen || child.stdin.destroyed || !child.stdin.writable) {
          return false
        }
        try {
          return child.stdin.write(`${JSON.stringify(message)}\n`)
        } catch {
          channelOpen = false
          abortHostCalls("SandboxChannelClosed", "Sandbox RPC response channel closed")
          return false
        }
      }

      child.stdin.on("error", () => {
        channelOpen = false
        abortHostCalls("SandboxChannelClosed", "Sandbox RPC response channel closed")
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

      const lines = createInterface({ input: child.stdout })
      lines.on("line", (line) => {
        outputBytes += Buffer.byteLength(line) + 1
        if (outputBytes > this.#maxOutputBytes) {
          outputLimited = true
          abortHostCalls("SandboxOutputLimit", "Sandbox output limit exceeded")
          child.kill("SIGKILL")
          return
        }
        let message: RunnerMessage
        try {
          const decoded = JSON.parse(line) as unknown
          if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
            throw new TypeError("protocol message must be an object")
          }
          message = decoded as RunnerMessage
        } catch {
          stderr += `Invalid sandbox protocol line: ${line}\n`
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
          try {
            terminal = { type: "complete", result: jsonValue(message.result, "Sandbox turn result") }
          } catch (error) {
            terminal = { type: "failed", error: serializeError(error) }
          }
          return
        }
        if (message.type === "failed") {
          terminal = message
          abortHostCalls("SandboxFailed", "Sandbox turn failed while host calls were active")
          return
        }
        if (message.type === "call") {
          if (!Number.isSafeInteger(message.id) || message.id < 1 || typeof message.name !== "string") {
            stderr += "Invalid sandbox call message\n"
            return
          }
          if (hostCalls.has(message.id)) {
            stderr += `Duplicate sandbox call id: ${message.id}\n`
            return
          }
          const call = this.#handleCall(
            message,
            functions,
            options,
            hostAbort.signal,
            writeResponse,
          )
          hostCalls.set(message.id, call)
          void call.finally(() => hostCalls.delete(message.id))
        }
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
    functions: AgentFunctionTable,
    options: SandboxExecuteOptions,
    signal: AbortSignal,
    writeResponse: (message: unknown) => boolean,
  ): Promise<void> {
    const binding = functions[call.name]
    try {
      if (!binding) throw new Error(`Generated code requested unknown function: ${call.name}`)
      if (signal.aborted) throw abortError(signal)
      const input = jsonValue(call.input, `${call.name} input`)
      await options.journal?.append({
        type: "function.called",
        turnId: options.turnId,
        sourceDigest: options.sourceDigest,
        functionName: call.name,
        callId: call.id,
        details: { input },
      })
      if (signal.aborted) throw abortError(signal)
      const context: AgentFunctionContext = {
        signal,
        turnId: options.turnId,
        sourceDigest: options.sourceDigest,
        functionName: call.name,
        callId: call.id,
      }
      const invoked = Promise.resolve(binding.invoke(input, context))
      const result = jsonValue(
        await abortable(invoked, signal),
        `${call.name} result`,
      )
      await options.journal?.append({
        type: "function.completed",
        turnId: options.turnId,
        sourceDigest: options.sourceDigest,
        functionName: call.name,
        callId: call.id,
        ok: true,
      })
      writeResponse({ id: call.id, ok: true, result })
    } catch (error) {
      const serialized = serializeError(error)
      try {
        await options.journal?.append({
          type: "function.completed",
          turnId: options.turnId,
          sourceDigest: options.sourceDigest,
          functionName: call.name,
          callId: call.id,
          ok: false,
          details: { error: serialized.message },
        })
      } catch {
        // The function response still closes even if an observation sink fails.
      }
      writeResponse({ id: call.id, ok: false, error: serialized })
    }
  }
}

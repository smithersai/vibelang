// The Process service over the host's `process` object and `node:os`: Node.js
// implements both, and Bun implements them as Node.js does.
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import type { Signal } from "effect/process/ChildProcess"
import type { ProcessId } from "effect/process/ChildProcessSpawner"
import * as Process from "../Process.js"

// The part of the host's process object this layer reads. The runtime declares
// it here rather than depending on @types/node, as its entry does.
interface Host {
  readonly pid: number
  readonly platform: string
  readonly arch: string
  readonly execPath: string
  readonly versions: Readonly<Record<string, string | undefined>>
  readonly memoryUsage: () => Process.MemoryUsage
  readonly kill: (pid: number, signal: string | number) => true
  readonly prependListener: (event: string, listener: () => void) => unknown
  readonly off: (event: string, listener: () => void) => unknown
  readonly getBuiltinModule: (id: "node:os") => unknown
}

interface Os {
  readonly hostname: () => string
  readonly availableParallelism: () => number
}

const systemErrors: Readonly<Record<string, PlatformError.SystemErrorTag>> = {
  ESRCH: "NotFound",
  EPERM: "PermissionDenied"
}

// A failed signal's PlatformError: no such process, not permitted, an unknown
// signal (Node.js throws ERR_UNKNOWN_SIGNAL, the system EINVAL), or Unknown.
const failure = (method: "kill" | "isRunning", pid: number, error: unknown): PlatformError.PlatformError => {
  const code = typeof error === "object" && error !== null ? (error as { readonly code?: unknown }).code : undefined
  const message = error instanceof Error ? error.message : String(error)
  if (code === "ERR_UNKNOWN_SIGNAL" || code === "EINVAL") {
    return PlatformError.badArgument({ module: "Process", method, description: message, cause: error })
  }
  return PlatformError.systemError({
    _tag: (typeof code === "string" ? systemErrors[code] : undefined) ?? "Unknown",
    module: "Process",
    method,
    syscall: "kill",
    pathOrDescriptor: pid,
    description: message,
    cause: error
  })
}

// The id process.kill takes: the process, or its group's negated id. A pid
// that is not a positive integer is refused, since 0 and negative ids name
// this process's own group or every process the user may signal.
const target = (
  host: Host,
  method: "kill" | "isRunning",
  pid: number,
  group: boolean | undefined
): Effect.Effect<number, PlatformError.PlatformError> => {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return Effect.fail(PlatformError.badArgument({
      module: "Process",
      method,
      description: `pid must be a positive integer, got ${pid}; signal a process group with { group: true }`
    }))
  }
  if (group === true && host.platform === "win32") {
    return Effect.fail(PlatformError.badArgument({
      module: "Process",
      method,
      description: "process groups are POSIX only; Windows has none"
    }))
  }
  return Effect.succeed(group === true ? -pid : pid)
}

// No process receives these: POSIX stops or kills it without a handler. Node.js
// throws when a listener is added for them and Bun accepts a listener that never runs, so the
// layer refuses them itself.
const uncatchable: ReadonlySet<string> = new Set(["SIGKILL", "SIGSTOP"])

const refused = (signal: Signal, why: string, cause?: unknown) =>
  PlatformError.badArgument({ module: "Process", method: "observeSignals", description: `cannot listen for ${signal}: ${why}`, cause })

// Listens for each signal; the first one received is the answer. The listener
// goes first, before runMain's: runMain's interrupts the program, and the
// finalizers that interruption runs can finish before any later listener runs.
// A signal the host refuses throws: undo the others and fail.
const observeSignals = <S extends Signal>(host: Host, signals: ReadonlyArray<S>) => {
  const listening = Effect.suspend(() => {
    const never = signals.find((signal) => uncatchable.has(signal))
    if (never !== undefined) return Effect.fail(refused(never, "no process can handle it"))
    let first: Option.Option<S> = Option.none()
    const added: Array<readonly [S, () => void]> = []
    const stop = () => {
      for (const [signal, listener] of added) host.off(signal, listener)
    }
    for (const signal of signals) {
      const listener = () => {
        if (Option.isNone(first)) first = Option.some(signal)
      }
      try {
        host.prependListener(signal, listener)
      } catch (error) {
        stop()
        return Effect.fail(refused(signal, error instanceof Error ? error.message : String(error), error))
      }
      added.push([signal, listener])
    }
    return Effect.succeed({ read: Effect.sync(() => first), stop })
  })
  return Effect.map(
    Effect.acquireRelease(listening, ({ stop }) => Effect.sync(stop)),
    ({ read }) => read
  )
}

const make = (): Process.Process => {
  const host = (globalThis as { readonly process?: Host }).process
  if (host === undefined || typeof host.getBuiltinModule !== "function") {
    throw new Error("The Process layer needs Node.js or Bun: this host has no process object")
  }
  const os = host.getBuiltinModule("node:os") as Os
  return Process.make({
    pid: Effect.sync(() => host.pid as ProcessId),
    platform: Effect.sync(() => host.platform as Process.Platform),
    arch: Effect.sync(() => host.arch),
    execPath: Effect.sync(() => host.execPath),
    versions: Effect.sync(() => {
      const versions: Record<string, string> = {}
      for (const [name, version] of Object.entries(host.versions)) {
        if (typeof version === "string") versions[name] = version
      }
      return versions
    }),
    hostname: Effect.sync(() => os.hostname()),
    availableParallelism: Effect.sync(() => os.availableParallelism()),
    timeOrigin: Effect.sync(() => globalThis.performance.timeOrigin),
    memoryUsage: Effect.sync(() => {
      const { rss, heapTotal, heapUsed, external, arrayBuffers } = host.memoryUsage()
      return { rss, heapTotal, heapUsed, external, arrayBuffers }
    }),
    kill: (pid, options) =>
      Effect.flatMap(target(host, "kill", pid, options?.group), (id) =>
        Effect.try({
          try: () => {
            host.kill(id, options?.killSignal ?? "SIGTERM")
          },
          catch: (error) => failure("kill", pid, error)
        })),
    isRunning: (pid, options) =>
      Effect.flatMap(target(host, "isRunning", pid, options?.group), (id) =>
        Effect.suspend(() => {
          try {
            host.kill(id, 0)
            return Effect.succeed(true)
          } catch (error) {
            const code = typeof error === "object" && error !== null
              ? (error as { readonly code?: unknown }).code
              : undefined
            // EPERM: the process exists, and belongs to someone else.
            if (code === "EPERM") return Effect.succeed(true)
            if (code === "ESRCH") return Effect.succeed(false)
            return Effect.fail(failure("isRunning", pid, error))
          }
        })),
    observeSignals: (signals) => observeSignals(host, signals)
  })
}

/** Provides `Process` over the host's `process` object and `node:os`. */
export const layer: Layer.Layer<Process.Process> = Layer.sync(Process.Process, make)

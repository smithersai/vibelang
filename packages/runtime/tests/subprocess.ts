type ChildResult = {
  readonly exitCode: number | null
  readonly exitedDueToTimeout?: boolean
  readonly signalCode?: string | number | null
  readonly stdout: { readonly byteLength: number }
  readonly stderr: { readonly byteLength: number }
}

type Observer = {
  readonly now?: () => number
  readonly report?: (record: string) => void
  readonly timeoutMs?: number
}

const signals = new Set(["SIGHUP", "SIGINT", "SIGQUIT", "SIGILL", "SIGABRT", "SIGFPE", "SIGKILL", "SIGSEGV", "SIGPIPE", "SIGTERM", "SIGBUS"])
const errors = new Set(["EACCES", "EAGAIN", "ENOENT", "ENOBUFS", "ETIMEDOUT"])
const count = (value: number) => Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value))) : 0

// Keep source, arguments, paths and output content out of failure evidence.
// Numeric nonzero exits are ordinary results: main deliberately tests them.
export function observeChild<T extends ChildResult>(host: "Node" | "Bun", run: () => T, observer: Observer = {}): T {
  const now = observer.now ?? (() => performance.now())
  const report = observer.report ?? (record => console.error(record))
  const started = now()
  const common = () => ({
    host,
    elapsedMs: count(now() - started),
    explicitTimeoutMs: observer.timeoutMs === undefined ? null : count(observer.timeoutMs)
  })
  try {
    const result = run()
    if (result.exitCode === null || result.exitedDueToTimeout) {
      report("[runtime-child] " + JSON.stringify({
        ...common(),
        stage: "child-exit",
        exitCode: result.exitCode,
        timeoutReported: result.exitedDueToTimeout === true,
        signal: typeof result.signalCode === "string" && signals.has(result.signalCode) ? result.signalCode : null,
        stdoutBytes: count(result.stdout.byteLength),
        stderrBytes: count(result.stderr.byteLength)
      }))
    }
    return result
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined
    report("[runtime-child] " + JSON.stringify({
      ...common(), stage: "spawn-error",
      errorCode: typeof code === "string" && errors.has(code) ? code : null
    }))
    throw error
  }
}

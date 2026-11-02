import { spawnSync } from "node:child_process"

// Fixture output is bounded independently per pipe so a noisy stdout cannot
// erase stderr or the final stage/termination record.
export function observedChild(command, args, options, stage, trace) {
  trace("child " + stage + " started " + JSON.stringify({ timeoutMs: options.timeout }))
  const started = performance.now()
  const result = spawnSync(command, args, options)
  const tail = value => value == null ? "" : String(value).slice(-4000)
  trace("child " + stage + " finished " + JSON.stringify({
    elapsedMs: Math.round(performance.now() - started),
    status: result.status, signal: result.signal, error: result.error?.code ?? null,
    stdout: tail(result.stdout), stderr: tail(result.stderr)
  }))
  return result
}

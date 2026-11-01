// One command of the first-run guide check, with its own deadline. The check runs
// five commands in sequence (scaffold, vitest, --version, compile, run); under one
// shared 30 s deadline a loaded host killed the whole test with no stage named (9 of
// 184 post-merge runs, median 5.4 s). Each stage now has STAGE_MS, and the test's
// deadline is STAGES * STAGE_MS, so a slow stage is killed and named on its own.
export const STAGE_MS = 60_000

export interface Stage {
  args: string[]
  exitCode: number | null
  signalCode: string | null
  stdout: string
  stderr: string
  /** Empty when the command exited 0 on its own; otherwise its output and, for a kill, the signal and deadline. */
  failure: string
}

export async function stage(args: string[], options: { cwd: string; env?: Record<string, string | undefined>; timeout?: number }): Promise<Stage> {
  const timeout = options.timeout ?? STAGE_MS
  const grouped = process.platform !== "win32"
  const child = Bun.spawn(args, { cwd: options.cwd, env: options.env, stdout: "pipe", stderr: "pipe", detached: grouped })
  let timedOut = false
  // Keep the deadline through pipe draining: a command can exit while its children
  // still hold stdout/stderr. On POSIX the session owns all these descendants.
  const timer = setTimeout(() => {
    timedOut = true
    if (grouped) {
      try { process.kill(-child.pid, "SIGKILL") }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    } else child.kill("SIGKILL")
  }, timeout)
  try {
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const signalCode = child.signalCode ?? null
    const exitCode = child.exitCode
    const detail = timedOut ? "\\nkilled by SIGKILL after " + timeout + " ms" : signalCode ? "\\nkilled by " + signalCode : ""
    const failure = exitCode === 0 && signalCode === null && !timedOut ? "" : stdout + stderr + detail
    return { args, exitCode, signalCode, stdout, stderr, failure }
  } finally {
    clearTimeout(timer)
  }
}

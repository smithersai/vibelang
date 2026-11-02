// A parity deadline owns process exit and output draining together.
// POSIX descendants inherit our process group even after their parent exits.
export async function exec(argv: string[], cwd: string, timeoutMs: number): Promise<{ code: number | string; stdout: string; stderr: string }> {
  const grouped = process.platform !== "win32"
  const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", detached: grouped })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    if (grouped) {
      try { process.kill(-proc.pid, "SIGKILL") }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    } else proc.kill("SIGKILL")
  }, timeoutMs)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited
    ])
    // The parent may have exited zero while a descendant still held a pipe.
    return { code: timedOut ? "timed out after " + timeoutMs + " ms" : proc.signalCode ? "killed by " + proc.signalCode : code, stdout, stderr }
  } finally { clearTimeout(timer) }
}

/** Execute one browser-audit command, recording its cost before the caller checks its exit. */
export async function contrastStage(command: string[], cwd: string, env: NodeJS.ProcessEnv) {
  console.log("site contrast stage:", command.join(" "), "NODE_ENV=" + (env.NODE_ENV ?? "unset"))
  const started = performance.now()
  try {
    const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    console.log("site contrast stage result:", JSON.stringify({
      command, elapsedMs: performance.now() - started, code, signal: child.signalCode ?? null,
    }))
    return { stdout, stderr, code }
  } catch (error) {
    console.log("site contrast stage result:", JSON.stringify({
      command, elapsedMs: performance.now() - started, code: null, signal: null,
      error: error instanceof Error ? error.message : String(error),
    }))
    throw error
  }
}

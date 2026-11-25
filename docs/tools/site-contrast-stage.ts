import { resolve } from "node:path"

export const contrastDeadline = 25 * 60_000

export function contrastEnvironment(command: string[], parent: NodeJS.ProcessEnv, bin: string, site: string) {
  const env = { ...parent }
  if (command.includes("build")) {
    env.NODE_ENV = "production"
    env.PATH = bin + ":" + parent.PATH
  }
  if (command.includes("test:404")) env.VIBELANG_DOCS_TEST_OUTPUT = resolve(site, "dist/public")
  delete env.VIBELANG_SITE_RELEASE_FILE
  delete env.VIBELANG_RELEASE_VERSION
  return env
}

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

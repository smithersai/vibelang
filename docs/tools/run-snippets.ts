import { join } from "node:path"

// A test that runs blocks takes its deadlines from here. A block runs in about
// 2 s on a quiet host and five times slower when the merge queue fills one, so
// the 10 s default of a documentation run failed a healthy block (main
// c080051ae52b). Only a block that hangs on purpose asks for less.
export const blockDeadline = 60_000
export const hangingBlockDeadline = 3_000
export const runTestLimit = 4 * blockDeadline

export async function runSnippets(root: string, compiler: string, json?: string, options: { filter?: string, deadline?: number } = {}) {
  const { filter, deadline = blockDeadline } = options
  const child = Bun.spawn([
    "bun", join(import.meta.dir, "check-snippets.ts"), "--root", root, "--compiler", compiler,
    "--run", "--timeout", String(deadline), ...(json ? ["--json", json] : []), ...(filter ? ["--filter", filter] : [])
  ], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ])
  return { stdout, stderr, status }
}

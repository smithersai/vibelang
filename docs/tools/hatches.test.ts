import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, extract } from "./check-snippets"
import { runSnippets, runTestLimit } from "./run-snippets"

const repo = resolve(import.meta.dir, "../..")
const compiler = defaultCompiler()

test.skipIf(!existsSync(compiler))("the rendered Promise adapter forwards cancellation, maps rejection, and retries before fallback", async () => {
  const example = (path: string) => extract(readFileSync(join(repo, path), "utf8"))
    .find(block => block.source.includes("effect function getTodo("))
  // The home page shows the adapter without the checker's lines.
  const program = (source: string) => source.replace(/^\s*\/\/ (?:run|pending|pending-decision):.*\n/gm, "")
  const onboarding = example("docs/user/src/001-onboarding.md")
  expect(onboarding).toBeDefined()
  expect(program(example("site/src/pages/index.mdx")!.source)).toBe(program(onboarding!.source))
  expect(onboarding!.run).toBeUndefined()
  // The adapter waits for the VIPs its pending line names. When it goes, give
  // the harness below the VIP form and a todos.ts beside the adapter.
  if (onboarding!.pending) return
  const temp = mkdtempSync(join(tmpdir(), "docs-hatches-"))
  try {
    writeFileSync(join(temp, "adapter.md"), "```vibe\n" + onboarding!.source + "\n```\n" + `
\`\`\`vibe
// run: checkAdapter()
function checkAdapter() {
  const original = sync(() => globalThis.fetch)
  try {
    sync(() => {
      globalThis.fetch = async (_input, init) => {
        if (!(init?.signal instanceof AbortSignal)) throw new Error("missing signal")
        return new Response("todo body")
      }
    })
    Console.log(getTodo(1))
    const attempts = sync(() => {
      let count = 0
      globalThis.fetch = async () => { count += 1; throw new Error("offline") }
      return () => count
    })
    const outcome = Effect.result(getTodo(1))
    if (outcome.isFailure()) Console.log(outcome.failure._tag)
    Console.log(todoOrFallback(1))
    Console.log(sync((read) => read(), attempts))
  } finally {
    sync((fetch) => { globalThis.fetch = fetch }, original)
  }
}
// Output: todo body
// Output: TodoFailed
// Output: Todo unavailable
// Output: 4
\`\`\`
`)
    const { stdout, stderr, status } = await runSnippets(temp, compiler)
    expect({ status, stderr, stdout }).toEqual({ status: 0, stderr: "", stdout: expect.stringContaining('"passed":1,"failed":0') })
  } finally { rmSync(temp, { recursive: true, force: true }) }
}, runTestLimit)

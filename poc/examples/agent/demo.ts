import assert from "node:assert/strict"
import { join } from "node:path"
import { AssetCompiler } from "../../src/build/index.ts"
import {
  CodingAgent,
  MemoryTurnJournal,
  ScriptedModel,
  defineFunction,
  mdxPrompt,
} from "../../src/agent/index.ts"

type DemoResult = {
  artifact: { digest: string; bytes: number }
  echoed: string
  ambient: {
    process: string
    deno: string
    fetch: string
    networkBlocked: boolean
    clockBlocked: boolean
    randomBlocked: boolean
  }
}

const invalidTurn = `
export default async function turn(functions: Functions) {
  return functions.readFile({ pat: "README.md" })
}
`

const repairedTurn = `
export default async function turn(functions: Functions) {
  const source = await functions.readFile({ path: "README.md" })
  console.log("read", source.length, "bytes")

  const [artifact, echoed] = await Promise.all([
    functions.build({ source }),
    functions.echo({ text: "agent loop works" }),
  ])

  let networkBlocked = false
  try {
    await (globalThis as any).fetch("https://example.com")
  } catch {
    networkBlocked = true
  }

  let clockBlocked = false
  try { Date.now() } catch { clockBlocked = true }
  let randomBlocked = false
  try { Math.random() } catch { randomBlocked = true }

  return {
    artifact,
    echoed,
    ambient: {
      process: typeof (globalThis as any).process,
      deno: typeof (globalThis as any).Deno,
      fetch: typeof (globalThis as any).fetch,
      networkBlocked,
      clockBlocked,
      randomBlocked,
    },
  }
}
`

export async function runAgentDemo(): Promise<{
  result: DemoResult
  model: ScriptedModel
  journal: MemoryTurnJournal
}> {
  const model = new ScriptedModel([invalidTurn, repairedTurn])
  const journal = new MemoryTurnJournal()
  const files: Record<string, string> = { "README.md": "# tiny in-memory project\n" }
  const assetCompiler = new AssetCompiler({
    root: join(import.meta.dir, ".."),
    cacheDirectory: join(import.meta.dir, ".demo-cache"),
  })
  const loadedPrompt = await assetCompiler.compile("assets/coding-agent.mdx")
  const promptModule = loadedPrompt.module.value as { body: string }

  const agent = CodingAgent.make<{ task: string }, DemoResult>({
    model,
    prompt: mdxPrompt(promptModule, ({ task }) => ({ task, repository: "effect-lang" })),
    functions: {
      readFile: defineFunction<{ path: string }, string>(
        "(input: { path: string }) => Promise<string>",
        async ({ path }) => {
          const value = files[path]
          if (value === undefined) throw new Error(`missing file: ${path}`)
          return value
        },
        "read a file from the demo project snapshot",
        {
          name: "demo/read-file",
          implementationId: "demo/read-file",
          implementationVersion: "1",
          config: { backend: "in-memory/v1" },
        },
      ),
      build: defineFunction<{ source: string }, { digest: string; bytes: number }>(
        "(input: { source: string }) => Promise<{ digest: string; bytes: number }>",
        async ({ source }) => {
          // Resolve after echo to exercise out-of-order concurrent RPC responses.
          await new Promise((resolve) => setTimeout(resolve, 10))
          return { digest: "demo-9f86d081", bytes: source.length }
        },
        "build a source artifact",
        {
          name: "demo/build",
          implementationId: "demo/build",
          implementationVersion: "1",
          config: { builder: "demo/v1" },
        },
      ),
      echo: defineFunction<{ text: string }, string>(
        "(input: { text: string }) => Promise<string>",
        ({ text }) => text.toUpperCase(),
        "uppercase text",
        {
          name: "demo/echo",
          implementationId: "demo/echo",
          implementationVersion: "1",
          config: { locale: "locale-independent" },
        },
      ),
    },
    journal,
    maxRepairs: 1,
  })

  const run = await agent.run({ task: "Read README.md, build it, and report confinement." })
  assert.equal(run.ok, true, run.error?.message)
  assert.ok(run.result)
  assert.equal(run.attempts.length, 2)
  assert.ok(run.attempts[0].diagnostics.length > 0)
  assert.equal(model.requests[1].diagnostics.length > 0, true)
  assert.equal(run.logs[0]?.values[0], "read")
  assert.match(run.sourceDigest ?? "", /^[a-f0-9]{64}$/)

  const result = run.result
  assert.equal(result.echoed, "AGENT LOOP WORKS")
  assert.equal(result.artifact.bytes, files["README.md"].length)
  assert.deepEqual(result.ambient, {
    process: "undefined",
    deno: "undefined",
    fetch: "undefined",
    networkBlocked: true,
    clockBlocked: true,
    randomBlocked: true,
  })

  const called = journal.events.filter((event) => event.type === "function.called")
  assert.deepEqual(
    called.map((event) => event.functionName).sort(),
    ["build", "echo", "readFile"],
  )

  return { result, model, journal }
}

if (import.meta.main) {
  const { result, journal } = await runAgentDemo()
  console.log(JSON.stringify({ result, journalEvents: journal.events.length }, null, 2))
}

import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import fc from "fast-check"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

const page = resolve(import.meta.dir, "../user/src/code-style/068-do.md")
const blocks = () => extract(readFileSync(process.env.INTERVAL_DOCS_PAGE || page, "utf8"))
  .map(block => ({ ...block, pending: undefined, fragment: false }))

async function checkInterval(index: number, millis = 40) {
  const root = mkdtempSync(join(tmpdir(), "interval-docs-"))
  try {
    linkModules(root)
    const examples = blocks().map(block => ({
      ...block,
      source: block.source.replaceAll("40 millis", millis + " millis"),
      run: block.run?.replaceAll("40 millis", millis + " millis"),
      output: block.output?.replaceAll(":40", ":" + millis)
    }))
    const block = examples[index]
    const result = await runBlock(join(root, "run"), examples,
      { ...block, status: "ok", diagnostics: [] }, defaultCompiler(), 10_000)
    expect({ block: index + 1, reason: result.reason, execution: result.execution }).toMatchObject({
      block: index + 1, reason: undefined, execution: { status: "passed", exitCode: 0, timedOut: false }
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("interval examples join before entering the JSON callback", async () => {
  for (const index of [1, 2, 3]) await checkInterval(index)
}, 120_000)

test("interval examples preserve their output at generated clock durations", async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 1, max: 80 }), fc.integer({ min: 1, max: 3 }),
    async (millis, index) => checkInterval(index, millis)
  ), { numRuns: 8 })
}, 120_000)

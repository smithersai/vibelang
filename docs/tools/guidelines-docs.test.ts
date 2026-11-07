import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import fc from "fast-check"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

const page = resolve(import.meta.dir, "../user/src/code-style/064-guidelines.md")

async function runExample(iterations?: number, millis = 1) {
  const root = mkdtempSync(join(tmpdir(), "entry-docs-"))
  try {
    linkModules(root)
    const blocks = extract(readFileSync(process.env.GUIDELINES_DOCS_PAGE || page, "utf8"))
      .map(block => ({ ...block, pending: undefined, fragment: false }))
    if (iterations !== undefined) {
      blocks[0].source = blocks[0].source
        .replaceAll('"2 seconds"', JSON.stringify(millis + " millis"))
        .replace("while (true)", "for (let once = 0; once < 1; once++)")
        .replace('try Console.log("checking work")',
          'for (let check = 0; check < ' + iterations + '; check++) { try Console.log("checking work") }')
      blocks[0].output = ["worker started", ...Array(iterations).fill("checking work"), "worker stopped"].join("\n")
    }
    const result = await runBlock(join(root, "run"), blocks,
      { ...blocks[0], status: "ok", diagnostics: [] }, defaultCompiler(), 10_000)
    expect({ reason: result.reason, execution: result.execution }).toMatchObject({
      reason: undefined, execution: { status: "passed", exitCode: 0, timedOut: false }
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("the application entry example finishes and runs its cleanup once", () => runExample(), 30_000)

test("generated entry workloads finish with one cleanup", async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 0, max: 4 }), fc.integer({ min: 1, max: 4 }),
    async (iterations, millis) => runExample(iterations, millis)
  ), { numRuns: 8 })
}, 120_000)

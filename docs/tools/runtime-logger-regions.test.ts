import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

test("runtime logger regions compile and restore visible output", async () => {
  const page = readFileSync(new URL("../user/src/036-runtime.md", import.meta.url), "utf8")
  const block = extract(page).find(block => block.source.includes("const Quiet ="))
  expect(block).toBeDefined()
  const root = mkdtempSync(join(tmpdir(), "runtime-logger-regions-"))
  let index = 0
  try {
    linkModules(root)
    const run = async (source = block!.source, output = block!.output) => {
      const example = { ...block!, source, output, fragment: false, pending: undefined }
      const result = await runBlock(join(root, String(index++)), [example],
        { ...example, status: "ok", diagnostics: [] }, defaultCompiler(), 60_000)
      expect({ status: result.status, reason: result.reason, execution: result.execution })
        .toEqual({ status: "ok", reason: undefined, execution: expect.objectContaining({
          phase: "run", status: "passed", exitCode: 0, stdout: output + "\n"
        }) })
    }
    await run()
    expect(block!.pending).toBeUndefined()
    const message = fc.array(fc.constantFrom("ready", "event", "region", "cleanup", "request", "done"),
      { minLength: 1, maxLength: 4 }).map(words => words.join(" "))
    await fc.assert(fc.asyncProperty(fc.tuple(message, message, message), async ([before, hidden, after]) => {
      const source = block!.source
        .replaceAll("visible before", before)
        .replaceAll("suppressed in this region", hidden)
        .replaceAll("visible after", after)
      await run(source, before + "\n" + after)
    }), { seed: 36035, numRuns: 12 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 240_000)


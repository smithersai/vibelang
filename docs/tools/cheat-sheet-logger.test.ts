import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

const repo = resolve(import.meta.dir, "../..")
const examples = extract(readFileSync(join(repo, "docs/user/src/vibelang-features/115-cheat-sheet.md"), "utf8"))
  .map(block => block.pending ? { ...block, pending: undefined, fragment: false } : block)
  .filter(block => !block.fragment && !block.expected.length && !block.source.includes("function wrappedCalls("))

for (const block of examples.filter(block => block.run?.includes("Logger.layer"))) {
  test("cheat-sheet logger example " + block.number + " prints its documented output", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cheat-sheet-logger-"))
    try {
      linkModules(temp)
      const result = await runBlock(join(temp, "example"), examples, {
        ...block, status: "ok", diagnostics: []
      }, defaultCompiler(), 10000)
      expect({ reason: result.reason, execution: result.execution }).toEqual({
        reason: undefined,
        execution: {
          phase: "run", status: "passed", expectedStdout: block.output!,
          stdout: block.output! + "\n", stderr: "", exitCode: 0, timedOut: false
        }
      })
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }, 60000)
}

import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { blockDeadline, hangingBlockDeadline, runSnippets, runTestLimit } from "./run-snippets"

test("a block deadline can report its own failure inside the test limit", () => {
  expect(hangingBlockDeadline).toBeLessThan(blockDeadline)
  expect(runTestLimit).toBeGreaterThanOrEqual(2 * blockDeadline)
})

test("runSnippets reports an unmatched filter without invoking the compiler", async () => {
  const root = mkdtempSync(join(tmpdir(), "run-snippets-"))
  try {
    writeFileSync(join(root, "guide.md"), "# Guide")
    const result = await runSnippets(root, join(root, "unused"), undefined, { filter: "missing-guide" })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("missing-guide")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

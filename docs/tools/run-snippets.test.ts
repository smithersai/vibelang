import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { blockDeadline, hangingBlockDeadline, runTestLimit } from "./run-snippets"

test("tests run blocks through runSnippets, which sets their deadlines", () => {
  const direct = readdirSync(import.meta.dir)
    .filter(file => file.endsWith(".test.ts") && file !== "run-snippets.test.ts")
    .filter(file => /check-snippets\.ts"\)[^)]*"--run"/.test(readFileSync(join(import.meta.dir, file), "utf8")))
  expect(direct).toEqual([])
})

test("a block deadline can report its own failure inside the test limit", () => {
  expect(hangingBlockDeadline).toBeLessThan(blockDeadline)
  expect(runTestLimit).toBeGreaterThanOrEqual(2 * blockDeadline)
})

// Many tests here compile a program and have no limit of their own; the graph
// runs them beside everything else, so bun's 5 s default fails a healthy compile.
test("//:docs-tools gives a test without a limit of its own a minute", () => {
  const targets = readFileSync(join(import.meta.dir, "../../PACKAGE.ts"), "utf8")
  expect(targets).toContain(`cd docs/tools && bun test --timeout ${blockDeadline} `)
})

import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { kernelFacts } from "./kernel-facts"

// A fixture repository whose one law test appends a line to runs.log, outside
// the suite's inputs, each time it really runs.
const repo = mkdtempSync(join(tmpdir(), "kernel-facts-"))
const runs = join(repo, "runs.log")
afterAll(() => rmSync(repo, { recursive: true, force: true }))
const write = (path: string, text: string) => {
  mkdirSync(join(repo, path, ".."), { recursive: true })
  writeFileSync(join(repo, path), text)
}
write("experiments/package.json", '{"private":true}\n')
write("experiments/tests/law.test.ts", `import { test } from "bun:test"\nimport { appendFileSync } from "node:fs"\ntest("law", () => { appendFileSync(${JSON.stringify(runs)}, "ran\\n") })\n`)
write("packages/runtime/src/kernel/kernel.ts", "a\nb\n")
write("packages/runtime/src/kernel/internals.ts", "c\n")
const ranCount = () => readFileSync(runs, "utf8").split("\n").filter(Boolean).length

test("the suite runs once per set of inputs, and a changed input runs it again", () => {
  const facts = { testCount: "1", testFiles: "1", kernelLines: "3" }
  expect(kernelFacts(repo)).toEqual(facts)
  expect(ranCount()).toBe(1)
  expect(kernelFacts(repo)).toEqual(facts)
  expect(ranCount()).toBe(1)
  write("packages/runtime/src/kernel/kernel.ts", "a\nb\nc\n")
  expect(kernelFacts(repo)).toEqual({ ...facts, kernelLines: "4" })
  expect(ranCount()).toBe(2)
  write("experiments/tests/law.test.ts", readFileSync(join(repo, "experiments/tests/law.test.ts"), "utf8") + "// edited\n")
  kernelFacts(repo)
  expect(ranCount()).toBe(3)
}, 60_000)

test("a failing suite leaves no receipt", () => {
  write("experiments/tests/law.test.ts", 'import { test, expect } from "bun:test"\ntest("law", () => { expect(1).toBe(2) })\n')
  expect(() => kernelFacts(repo)).toThrow("the kernel law suite in experiments/ failed")
  expect(() => kernelFacts(repo)).toThrow("the kernel law suite in experiments/ failed")
}, 60_000)

import { expect, test } from "bun:test"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

const example = () => extract(readFileSync(new URL("../user/src/data-types/077-exit.md", import.meta.url), "utf8"))[1]

async function observe(block: ReturnType<typeof example>) {
  const temp = mkdtempSync(join(tmpdir(), "exit-data-output-"))
  try {
    linkModules(temp)
    return await runBlock(join(temp, "run"), [{ ...block, pending: undefined, fragment: false }],
      { ...block, pending: undefined, fragment: false, status: "ok", diagnostics: [] },
      defaultCompiler(), 10000)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

test("the Exit constructor example compiles and prints both outcomes", async () => {
  const result = await observe(example())
  expect(result.execution?.stdout, result.reason).toBe(example().output + "\n")
  expect(result.status).toBe("ok")
  expect(example().pending).toBeUndefined()
}, 30000)

test("Exit output checks keep narrowing for varied payloads", async () => {
  await fc.assert(fc.asyncProperty(fc.integer(), fc.string(), fc.string(), async (value, failure, defect) => {
    const block = example()
    block.source = block.source.replaceAll("Exit.succeed(12)", "Exit.succeed(" + value + ")")
      .replace('"write rejected"', JSON.stringify(failure))
      .replace('"release failed"', JSON.stringify(defect))
    const result = await observe(block)
    expect(result.status, result.execution?.stdout).toBe("ok")
  }), { seed: 7702, numRuns: 8 })
}, 60000)

// Native Effect.onExit passes cleanup the program's own exit, value included; an old
// `finally (exit)` clause received Exit.void on success. The page must say which is which,
// and its example must show both while the program keeps its value.
const page = () => readFileSync(new URL("../user/src/data-types/077-exit.md", import.meta.url), "utf8")
const onExitExample = () => {
  const blocks = extract(page()).filter(block => block.run?.includes("Effect.onExit"))
  expect(blocks.length).toBe(1)
  return blocks[0]
}

test("the Effect.onExit example shows cleanup gets the program's value, and the old contract's Exit.void", async () => {
  const block = onExitExample()
  expect(block.output).toBe("Success 12\nSuccess undefined\nresult 12 12")
  const result = await observe(block)
  expect(result.execution?.stdout, result.reason).toBe(block.output + "\n")
  expect(page()).not.toMatch(/native `Effect\.onExit`, which passes the successful cleanup input `Exit\.void`/)
}, 30000)

test("Effect.onExit hands cleanup any success value and still returns it", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: -1000000, max: 1000000 }), async (value) => {
    const block = onExitExample()
    block.run = block.run!.replaceAll("Effect.succeed(12)", "Effect.succeed(" + value + ")")
    const result = await observe(block)
    expect(result.execution?.stdout, result.reason).toBe(`Success ${value}\nSuccess undefined\nresult ${value} ${value}\n`)
  }), { seed: 7711, numRuns: 4 })
}, 60000)

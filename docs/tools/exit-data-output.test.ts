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

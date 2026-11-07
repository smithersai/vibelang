import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

const page = readFileSync(new URL("../user/src/schema/087-basic-usage.md", import.meta.url), "utf8")
// Exercise every published output even if a marker would hide it from the
// ordinary snippet check. The source and earlier declarations remain unchanged.
const blocks = extract(page).map(block => ({ ...block, pending: undefined, fragment: false }))

for (const block of blocks) {
  test(`basic schema example ${block.number} executes its documented output`, async () => {
    expect(block.output).toBeDefined()
    const dir = mkdtempSync(join(tmpdir(), "schema-basic-example-"))
    try {
      linkModules(dir)
      const result = await runBlock(join(dir, "run"), blocks, {
        ...block, status: "ok", diagnostics: []
      }, defaultCompiler(), 10000)
      expect(result, JSON.stringify(result.execution)).toMatchObject({
        status: "ok", execution: { phase: "run", status: "passed", exitCode: 0 }
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 90000)
}

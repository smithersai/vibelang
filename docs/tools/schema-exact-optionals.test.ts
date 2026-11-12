import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

// Schema Getting Started says an optional field's handling of a present `undefined` follows
// exactOptionalPropertyTypes, and tabulates the output of its example under each setting and
// field spelling. Run the page's own example in each configuration and compare with the table.
const page = () => readFileSync(new URL("../user/src/schema/086-getting-started.md", import.meta.url), "utf8")

function example() {
  const blocks = extract(page()).filter(block => block.source.includes("schema Nickname"))
  expect(blocks.length).toBe(1)
  return blocks[0]
}

function table(): { exact: boolean; field: string; output: string }[] {
  const rows = [...page().matchAll(/^\| `(true|false)` \| `(name\?: [^`]+)` \| `([^`]+)` \|$/gm)]
  return rows.map(([, exact, field, output]) => ({ exact: exact === "true", field: field.replace("\\|", "|"), output }))
}

async function run(source: string, exact: boolean) {
  const block = { ...example(), source, pending: undefined, fragment: false }
  const temp = mkdtempSync(join(tmpdir(), "schema-exact-optionals-"))
  try {
    linkModules(temp)
    return await runBlock(join(temp, "run"), [block], { ...block, status: "ok", diagnostics: [] },
      defaultCompiler(), 20000, { exactOptionalPropertyTypes: exact })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

test("the page tabulates both settings and both field spellings", () => {
  expect(table()).toEqual([
    { exact: true, field: "name?: string", output: "true false" },
    { exact: false, field: "name?: string", output: "true true" },
    { exact: true, field: "name?: string | undefined", output: "true true" },
  ])
})

for (const row of [
  { exact: true, field: "name?: string", output: "true false" },
  { exact: false, field: "name?: string", output: "true true" },
  { exact: true, field: "name?: string | undefined", output: "true true" },
]) {
  test(`exactOptionalPropertyTypes ${row.exact}, ${row.field}: prints ${row.output}`, async () => {
    const source = example().source.replace("name?: string | undefined", row.field)
    const result = await run(source, row.exact)
    expect(result.execution?.stdout, result.reason).toBe(row.output + "\n")
  }, 60000)
}

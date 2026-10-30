import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = process.env.SPEC_TEST_ROOT || fileURLToPath(new URL("../..", import.meta.url))
const read = path => readFileSync(resolve(repo, path), "utf8")

for (const path of ["docs/design/src/007-tooling.md", "docs/design/vips/0034-compiler-and-tooling.md"]) {
 test(path + " assigns diagnostics by the rejected source rule", () => {
  const text = read(path)
  assert.match(text, /Every VibeLang diagnostic/, "native diagnostics need their own identity")
  assert.match(text, /TypeScript.*own lexical, syntax and static errors.*`TS`/s)
  assert.match(text, /embedded expressions and types/)
  assert.match(text, /VibeLang production, placement rule, proposal-specific early error.*reconciliation/s)
  assert.match(text, /owning VIP.*`EK`/s)
  assert.match(text, /TypeScript parser helper/)
  assert.match(text, /specific diagnostic.*same rejection/s)
  assert.match(text, /independent native errors/)
 })
}

test("the CLI guide preserves native diagnostics inside embedded code", () => {
 const text = read("docs/user/src/setup/vibelang-cli.md")
 assert.match(text, /TypeScript.*own lexical, syntax and static errors.*`TS` codes/s)
 assert.match(text, /embedded expressions and types/)
 assert.match(text, /owning VIP.*`EK` codes/s)
 assert.match(text, /independent native errors still report/)
})

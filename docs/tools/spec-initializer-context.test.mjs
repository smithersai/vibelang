import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read, block, run } from "./spec-witness.mjs"

test("initializer resets, inherited heads and static reservation have one source-context rule", () => {
  for (const name of ["001-functions", "002-running", "900-appendices"]) {
    assert.match(chapter(name), /class field and enum member initializers/i)
  }
  const section = chapter("900-appendices").split("### The `[Effect]` parameter")[1].split("### Contextual keywords")[0]
  assert.match(section, /initializers.*`\[~Effect\]`/)
  assert.match(section, /static.*`\[\?Effect\]`/i)
  assert.match(section, /Class heritage and computed class element names/)
  assert.match(section, /body of any source callable without an `effect` modifier/)
  assert.match(section, /nested explicit Effect callable or block/)
})

test("plain static identifiers and reserved static execution stay distinct under VIP-17", () => {
  const appendix = chapter("900-appendices")
  assert.match(appendix, /class Plain \{ static \{ join\(9\); fork\(9\) \} \}/)
  assert.match(appendix, /class Reserved \{ static \{ join\(1\) \} \}.*EK1701/)
  assert.match(appendix, /enum E \{ A = try Effect\.succeed\(1\) \}.*EK0501/)
  assert.match(read("docs/design/vips/0017-fork.md"), /outside-code identifier promise/)
})

test("the printed field, enum, head and nested-Effect counterpart returns its source values", () => {
  const source = block(chapter("900-appendices"), "const contextBoundaries", "ts effect")
  const result = run(source + "\nconsole.log(JSON.stringify(Effect.runSyncExit(contextBoundaries)))\n")
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { _id: "Exit", _tag: "Success", value: [2, 3, 7] })
})

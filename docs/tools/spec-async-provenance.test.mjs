import assert from "node:assert/strict"
import test from "node:test"
import { lexer } from "marked"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("async match has explicit source contexts and a checked native Promise witness", () => {
  const match = chapter("004-match")
  assert.ok(!match.includes("As in TC39's `async do`, whose grammar"))
  assert.ok(match.includes("`[~Yield, +Await, ~Return, ~Effect]` contexts"))
  assert.ok(match.includes("Nested source callables retain their own grammar contexts"))
  assert.ok(read("docs/design/vips/0007-match.md").includes("explicit async-match body contexts"))
  assert.ok(!read("docs/design/vips/0007-match.md").includes("syntax error, as in TC39's `async do`"))
  const table = lexer(read("docs/design/vips/tc39-pattern-matching/README.md")).find(t => t.type === "table" && t.header[0].text === "Step")
  assert.ok(table?.rows.some(row => row[0].text === "`async match`, its grammar contexts"))
  assert.ok(read("docs/design/vips/tc39-pattern-matching/README.md").includes("self-contained source grammar"))
  const result = run(block(match, "function asyncLabel", "ts effect") + `
import assert from "node:assert/strict"
assert.equal(await asyncLabel(Promise.resolve("sent")), "sent")
await assert.rejects(asyncLabel(Promise.resolve("other")), TypeError)
assert.equal(await asyncNested(Promise.resolve("sent")), 1)
assert.equal(await asyncNested(Promise.resolve("other")), 0)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

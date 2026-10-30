import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("schema-reference admission checks decoded flags at every source position", () => {
  const data = chapter("006-data")
  assert.ok(data.includes("required fixed tuple slot (before or after a rest), and `Record` value"))
  assert.ok(data.includes("all `schema error` payload fields are effectively readonly"))
  assert.ok(data.includes("through aliases and unions"))
  assert.ok(data.includes("A conflicting or unprovable flag is `EK2109`"))
  const result = run(block(data, "const FlagIntent") + `
import assert from "node:assert/strict"
const valid = { must: undefined, frozen: "ok", tuple: [undefined], entries: { a: undefined } }
assert.equal(decodeFlagIntent(valid)._tag, "Success")
for (const bad of [
  { frozen: "ok", tuple: [undefined], entries: { a: undefined } },
  { ...valid, tuple: [] }, { ...valid, entries: {} }, { ...valid, tuple: ["bad"] }
]) assert.equal(decodeFlagIntent(bad)._tag, "Failure")
assert.equal(Schema.decodeUnknownExit(FlagError)({ _tag: "FlagError", value: "ok" })._tag, "Success")
const optional = Schema.optional(Schema.Number)
// The old mappings lose requiredness at each independently mapped position.
assert.equal(Schema.decodeUnknownExit(Schema.Struct({ must: Schema.mutableKey(optional) }))({})._tag, "Success")
assert.equal(Schema.decodeUnknownExit(Schema.Tuple([optional]))([])._tag, "Success")
assert.equal(Schema.decodeUnknownExit(Schema.Record(Schema.Literal("a"), optional))({})._tag, "Success")
const trailing = Schema.TupleWithRest(Schema.Tuple([]), [Schema.String, PresentNumber])
assert.equal(Schema.decodeUnknownExit(trailing)([])._tag, "Failure")
assert.equal(Schema.decodeUnknownExit(trailing)(["x", undefined])._tag, "Success")
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("schema encoding preserves the codec representation before transport", () => {
  const data = chapter("006-data")
  assert.ok(data.includes("a declaration does not automatically convert unsupported values or property keys"))
  assert.ok(chapter("003-failures").includes("transports must support that representation"))
  assert.ok(!chapter("003-failures").includes("so the error can be decoded from JSON and crosses workers and RPC"))
  const result = run(block(data, "const jsonTransportExit") + `
import assert from "node:assert/strict"
assert.equal(typeof encodedBigCount.count, "bigint")
assert.equal(jsonTransportExit._tag, "Failure")
assert.equal(jsonTransportExit.cause.reasons[0]._tag, "Fail")
assert.ok(jsonTransportExit.cause.reasons[0].error instanceof TypeError)
assert.equal(encodedJsonCount.count, "1")
assert.equal(jsonRoundTripExit._tag, "Success")
assert.equal(jsonRoundTripExit.value.count, 1n)
class NumberField extends Schema.TaggedError<NumberField>()("NumberField", { value: Schema.Number }) {}
class SymbolField extends Schema.TaggedError<SymbolField>()("SymbolField", { value: Schema.Symbol }) {}
const key = Symbol("key")
class SymbolKey extends Schema.TaggedError<SymbolKey>()("SymbolKey", { [key]: Schema.String }) {}
for (const value of [NaN, Infinity, -Infinity]) {
  const wire = JSON.parse(JSON.stringify(Schema.encodeSync(NumberField)(new NumberField({ value }))))
  assert.equal(wire.value, null)
  assert.equal(Schema.decodeUnknownExit(NumberField)(wire)._tag, "Failure")
}
const symbolWire = JSON.parse(JSON.stringify(Schema.encodeSync(SymbolField)(new SymbolField({ value: Symbol("x") }))))
assert.equal(Schema.decodeUnknownExit(SymbolField)(symbolWire)._tag, "Failure")
const keyWire = JSON.parse(JSON.stringify(Schema.encodeSync(SymbolKey)(new SymbolKey({ [key]: "x" }))))
assert.equal(Schema.decodeUnknownExit(SymbolKey)(keyWire)._tag, "Failure")
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

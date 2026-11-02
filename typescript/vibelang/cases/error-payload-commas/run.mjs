import assert from "node:assert/strict"
import { Effect, Schema } from "effect"
import { matrix } from "./out/main.js"
import { matrix as counterparts } from "./out/counterpart.js"

assert.equal(matrix.length, 16)
assert.equal(counterparts.length, 16)
for (const [index, [definition, value, args, key, expected, encoded]] of matrix.entries()) {
  const [nativeDefinition, nativeValue] = counterparts[index]
  assert.equal(value[key], expected, definition.name)
  assert.equal(nativeValue[key], expected, definition.name)
  assert.equal(value._tag, nativeValue._tag, definition.name)
  for (const [program, error] of [[definition, value], [nativeDefinition, nativeValue]]) {
    assert.equal(error instanceof program, true, definition.name)
    const exit = Effect.runSyncExit(error)
    assert.equal(exit._tag, "Failure", definition.name)
    assert.equal(exit.cause.reasons[0]._tag, "Fail", definition.name)
    assert.equal(exit.cause.reasons[0].error, error, definition.name)
  }
  if (encoded) {
    const payload = { _tag: definition.name, ...args }
    const decoded = Schema.decodeUnknownSync(definition)(payload)
    const nativeDecoded = Schema.decodeUnknownSync(nativeDefinition)(payload)
    assert.equal(decoded[key], nativeDecoded[key], definition.name)
    assert.deepEqual(Schema.encodeSync(definition)(decoded), payload, definition.name)
    assert.deepEqual(Schema.encodeSync(nativeDefinition)(nativeDecoded), payload, definition.name)
  }
}
console.log("comma payload fields: 16/16 Effect counterparts")

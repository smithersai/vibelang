import assert from "node:assert/strict"
import { Effect, Schema } from "effect"
import { matrix, values } from "./out/main.js"

assert.deepEqual(values, ["plain", "schema"])
assert.equal(matrix.length, 16)
for (const [definition, key, optional, schema] of matrix) {
  for (const present of optional ? [true, false] : [true]) {
    const payload = present ? { [key]: "value" } : {}
    const value = new definition(payload)
    assert.equal(value[key], present ? "value" : undefined, definition.name)
    assert.equal(value.label, present ? "value" : "absent", definition.name)
    assert.equal(Object.hasOwn(value, key), present, definition.name)
    assert.equal(value._tag, definition.name)
    const exit = Effect.runSyncExit(value)
    assert.equal(exit._tag, "Failure", definition.name)
    assert.equal(exit.cause.reasons[0]._tag, "Fail", definition.name)
    assert.equal(exit.cause.reasons[0].error, value, definition.name)
    if (schema) {
      const encoded = { _tag: definition.name, ...payload }
      const decoded = Schema.decodeUnknownSync(definition)(encoded)
      assert.equal(decoded[key], value[key], definition.name)
      assert.deepEqual(Schema.encodeSync(definition)(decoded), encoded, definition.name)
      assert.throws(() => Schema.decodeUnknownSync(definition)({ _tag: definition.name, [key]: 123 }))
    }
  }
}
console.log(JSON.stringify(values))

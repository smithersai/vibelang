import assert from "node:assert/strict"
import { Effect, Schema } from "effect"
const definitions = await import("./out/main.js")
let checks = 0
for (const [name, definition] of Object.entries(definitions)) {
  const nested = name.startsWith("Nested")
  const error = name.endsWith("Error")
  const payload = { ["__proto__"]: name }
  const encoded = nested ? { value: payload } : error ? { _tag: name, ...payload } : payload
  const value = Schema.decodeUnknownSync(definition)(encoded)
  const field = nested ? value.value : value
  assert.equal(Object.hasOwn(field, "__proto__"), true, name)
  assert.equal(field.__proto__, name, name)
  assert.deepEqual(Schema.encodeSync(definition)(value), encoded, name)
  for (const invalid of [{}, { ["__proto__"]: 42 }]) {
    const input = nested ? { value: invalid } : error ? { _tag: name, ...invalid } : invalid
    assert.throws(() => Schema.decodeUnknownSync(definition)(input), undefined, name)
  }
  if (error) {
    const constructed = new definition(payload)
    assert.equal(Object.hasOwn(constructed, "__proto__"), true, name)
    assert.equal(constructed.__proto__, name, name)
    const exit = Effect.runSyncExit(constructed)
    assert.equal(exit._tag, "Failure", name)
    assert.equal(exit.cause.reasons[0]._tag, "Fail", name)
    assert.equal(exit.cause.reasons[0].error, constructed, name)
  }
  checks++
}
assert.equal(checks, 11)
console.log("own __proto__ schema fields: 11/11")

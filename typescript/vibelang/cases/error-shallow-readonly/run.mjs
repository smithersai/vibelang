import assert from "node:assert/strict"
import { Data, Effect, Schema } from "effect"
import { Plain, Serializable, mutate } from "./out/main.js"

const methods = {
  make() { return { count: 1 } },
  update(input) { input.count = 4 },
  local() { const input = { count: 1 }; input.count = 5; return input.count }
}
class NativePlain extends Data.TaggedError("Plain") {}
const nested = Schema.Struct({ count: Schema.mutableKey(Schema.Number) })
class NativeSerializable extends Schema.TaggedError()("Serializable", {
  value: nested,
  values: Schema.mutable(Schema.Array(nested))
}) {}
for (const definition of [NativePlain, NativeSerializable]) {
  Object.assign(definition.prototype, methods)
}

const observations = []
for (const [vibe, native, schema] of [[Plain, NativePlain, false], [Serializable, NativeSerializable, true]]) {
  for (const definition of [vibe, native]) {
    const error = new definition({ value: { count: 1 }, values: [{ count: 1 }] })
    const observed = mutate(error)
    assert.deepEqual(observed, [2, 3, 6, 5, 4])
    const exit = Effect.runSyncExit(error)
    assert.equal(exit._tag, "Failure")
    assert.equal(exit.cause.reasons[0]._tag, "Fail")
    assert.equal(exit.cause.reasons[0].error, error)
    if (schema) {
      const encoded = { _tag: "Serializable", value: { count: 2 }, values: [{ count: 3 }] }
      assert.deepEqual(Schema.encodeSync(definition)(error), encoded)
      const decoded = Schema.decodeUnknownSync(definition)(encoded)
      assert.deepEqual(mutate(decoded), observed)
    }
    observations.push(observed)
  }
}
assert.deepEqual(observations[0], observations[1])
assert.deepEqual(observations[2], observations[3])
console.log(JSON.stringify(observations))

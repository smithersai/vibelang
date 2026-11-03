import assert from "node:assert/strict"
import { Data, Effect, Schema } from "effect"
import { Entry, SchemaEntry, entry, schemaEntry, fields, schemaFields } from "./out/main.js"

const key = "computed"
class Reference extends Data.TaggedError("Entry") {}
class SchemaReference extends Schema.TaggedError()("SchemaEntry", {
  quoted: Schema.Number,
  7: Schema.Number,
  [key]: Schema.Number
}) {}

const payloads = [{ quoted: 1, 7: 2, computed: 3 }, { quoted: 4, 7: 5, computed: 6 }]
for (const [value, reference, payload, definition] of [
  [entry, new Reference(payloads[0]), payloads[0], Entry],
  [schemaEntry, new SchemaReference(payloads[1]), payloads[1], SchemaEntry]
]) {
  assert.ok(value instanceof definition)
  for (const name of Reflect.ownKeys(payload)) {
    assert.equal(value[name], reference[name])
    assert.ok(Object.hasOwn(value, name))
  }
  assert.equal(value._tag, reference._tag)
  const exit = Effect.runSyncExit(value)
  assert.equal(exit._tag, "Failure")
  assert.equal(exit.cause.reasons[0]._tag, "Fail")
  assert.equal(exit.cause.reasons[0].error, value)
}

const encoded = { _tag: "SchemaEntry", ...payloads[1] }
const decoded = Schema.decodeUnknownSync(SchemaEntry)(encoded)
assert.deepEqual(Schema.encodeSync(SchemaEntry)(decoded), encoded)
for (const name of Reflect.ownKeys(payloads[1])) {
  const missing = { ...encoded }
  delete missing[name]
  assert.throws(() => Schema.decodeUnknownSync(SchemaEntry)(missing))
  assert.throws(() => Schema.decodeUnknownSync(SchemaEntry)({ ...encoded, [name]: "wrong" }))
}
assert.deepEqual(fields, [1, 2, 3])
assert.deepEqual(schemaFields, [4, 5, 6])
console.log(JSON.stringify([fields, schemaFields]))

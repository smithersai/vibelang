import assert from "node:assert/strict"
import { Schema } from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const exact = true
const show = x => JSON.parse(JSON.stringify(x, (_k, v) => v === undefined ? "$undefined" : v))
const ok = (schema, input) => Schema.decodeUnknownExit(schema)(input)._tag === "Success"
const base = { items: [], table: {}, pair: ["a"] }
const samples = {
  S: [{}, { plain: undefined }, { plain: "ok" }, { plain: 1 }, { frozen: undefined }, { loose: undefined },
    { nested: undefined }, { nested: {} }, { nested: { value: undefined } }, { nested: { inner: { deep: undefined } } }],
  N: [base, { ...base, items: [{}, { tag: undefined }] }, { ...base, table: { k: { n: undefined } } },
    { ...base, pair: ["a", undefined] }, { ...base, pair: ["a", 1] }],
  E: [{}, { plain: undefined }, { loose: undefined }, { plain: "ok" }].map(x => ({ _tag: "E", ...x })),
  T: [["a"], ["a", undefined], ["a", 1], ["a", "b"]],
  U: [["a"], ["a", undefined], ["a", 1]]
}
// The sugar decodes exactly as its Effect twin under the same setting.
for (const [name, inputs] of Object.entries(samples))
  for (const input of inputs)
    assert.deepEqual(show(Schema.decodeUnknownExit(V[name])(input)), show(Schema.decodeUnknownExit(T[name])(input)), name + " " + JSON.stringify(input))
// Missing keys and elements always decode.
for (const [name, input] of [["S", {}], ["N", base], ["E", { _tag: "E" }], ["T", ["a"]], ["U", ["a"]]])
  assert.equal(ok(V[name], input), true, name + " missing")
// A present undefined: `name?: T` and `T?` admit it only with the setting off.
const plainUndefined = [
  ["S field", V.S, { plain: undefined }], ["S readonly field", V.S, { frozen: undefined }],
  ["S nested", V.S, { nested: { value: undefined } }], ["S nested inner", V.S, { nested: { inner: { deep: undefined } } }],
  ["S nested struct", V.S, { nested: undefined }],
  ["N array element", V.N, { ...base, items: [{ tag: undefined }] }],
  ["N record value", V.N, { ...base, table: { k: { n: undefined } } }],
  ["N tuple field", V.N, { ...base, pair: ["a", undefined] }],
  ["E schema error", V.E, { _tag: "E", plain: undefined }],
  ["T tuple", V.T, ["a", undefined]]
]
for (const [label, schema, input] of plainUndefined) assert.equal(ok(schema, input), !exact, label)
// `name?: T | undefined` and `(T | undefined)?` admit it under both settings.
for (const [label, schema, input] of [["S loose", V.S, { loose: undefined }], ["E loose", V.E, { _tag: "E", loose: undefined }], ["U tuple", V.U, ["a", undefined]]])
  assert.equal(ok(schema, input), true, label)
// Native data payloads keep TypeScript's types; the constructor itself does not validate.
assert.deepEqual(V.D.Ready({ plain: "ok" }), T.D.Ready({ plain: "ok" }))
assert.deepEqual(V.looseUndefined, T.looseUndefined)
assert.equal("loose" in V.looseUndefined, true)
// The chapter's exact optional-key contract.
assert.equal(ok(V.Exact, {}), true)
assert.equal(ok(V.Exact, { name: undefined }), false)
assert.equal(ok(V.Exact, { explicit: undefined }), true)
assert.equal(ok(V.Exact, { name: "a", explicit: "b" }), true)

console.log("ok w01 optional " + (exact ? "on" : "off"))

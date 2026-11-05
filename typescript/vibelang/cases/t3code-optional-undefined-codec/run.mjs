import assert from "node:assert/strict"
import { Schema } from "effect"
import { Value, Grouped } from "./out/main.js"
for (const input of [{}, {value: undefined}, {value: "ok"}]) assert.equal(Schema.decodeUnknownExit(Value)(input)._tag, "Success")
assert.equal(Schema.decodeUnknownExit(Value)({value: null})._tag, "Failure")
for (const input of [{}, {value: undefined}, {value: "a"}, {value: "b"}]) assert.equal(Schema.decodeUnknownExit(Grouped)(input)._tag, "Success")
assert.equal(Schema.decodeUnknownExit(Grouped)({value: "c"})._tag, "Failure")
console.log("ok optional codec")

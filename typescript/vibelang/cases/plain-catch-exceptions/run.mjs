import assert from "node:assert/strict"
import { f, messageOf, thrownBy, prototypeOf, parseOr, primitive, getter, revoked, prototype } from "./out/main.js"
import { failure } from "./out/fixtures.js"
assert.equal(f(primitive), "")
assert.equal(messageOf(getter), "caught")
assert.equal(thrownBy(getter), failure)
assert.equal(f(revoked), "")
assert.equal(prototypeOf(prototype), "")
assert.equal(f(1), "1")
assert.equal(parseOr("{"), "syntax")
assert.equal(parseOr("{}"), "parsed")
console.log("ok")

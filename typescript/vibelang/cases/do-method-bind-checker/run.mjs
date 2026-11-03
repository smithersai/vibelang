import * as assert from "node:assert/strict"
import * as actual from "./out/main.js"
assert.equal(actual.probe(), 3)
assert.equal(actual.numericBind(), 4)
assert.equal(actual.genericBind(), "kept")
assert.equal(actual.overloadedBind(), "overload")
assert.equal(actual.explicitThis(), 12)
assert.equal(actual.elementAccess(), 3)
assert.equal(actual.taggedTemplate(), 4)
assert.equal(actual.writtenBind(), "wrong")

console.log("ok")

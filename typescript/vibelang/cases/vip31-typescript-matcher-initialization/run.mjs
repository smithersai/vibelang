import assert from "node:assert/strict"
// The scenario needs a host without a native Symbol.customMatcher.
assert.equal(Object.getOwnPropertyDescriptor(Symbol, "customMatcher"), undefined)
const { order } = await import("./out/main.js")
const { customMatcher } = await import("vibelang-runtime")
assert.equal(Symbol.customMatcher, customMatcher)
console.log(JSON.stringify(order))

import assert from "node:assert/strict"
const m = await import("./out/main.js")
assert.deepEqual(m.started, [42, "done"])
// The explicit runner ran main once; nothing else started it.
assert.equal(m.calls, 1)
console.log("top-level await ran main once")

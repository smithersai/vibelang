import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"

function observe(run, initialized, lexical) {
  const events = []
  try {
    run(events, initialized, lexical)
    return { events, error: null }
  } catch (error) {
    return { events, error: { name: error.name, message: error.message } }
  }
}
let count = 0
for (const name of Object.keys(native)) {
  for (const initialized of [false, true]) {
    for (const lexical of [false, true]) {
      const expected = observe(native[name], initialized, lexical)
      assert.deepEqual(observe(actual[name], initialized, lexical), expected,
        name + " initialized=" + initialized + " lexical=" + lexical)
      if (name !== "method") {
        assert.equal(expected.error?.name ?? null, initialized ? null : "ReferenceError")
        assert.equal(expected.events.includes("do"), initialized)
      }
      count++
    }
  }
}
console.log(count + " native comparisons passed")

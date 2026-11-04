import assert from "node:assert/strict"
import { Effect } from "effect"
import * as program from "./out/main.js"
import * as twin from "./out/twin.js"
for (const name of ["compact", "expanded", "declared", "expression", "declaredProgram"]) {
  for (const start of [-5, 0, 1, 10]) {
    const observe = (factory) => {
      const p = factory(start)
      return [Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]
    }
    const expected = observe(twin[name])
    assert.deepEqual(expected, [start + 1, start + 2, start + 3])
    assert.deepEqual(observe(program[name]), expected, name)
  }
}
console.log("call-bound parameters: ok")

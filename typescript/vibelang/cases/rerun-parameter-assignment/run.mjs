import assert from "node:assert/strict"
import { Effect } from "effect"
import * as program from "./out/main.js"
import * as twin from "./out/twin.js"

for (const [label, name] of [
  ["compact", "compact"], ["expanded", "expanded"], ["declaration", "declared"],
  ["expression", "expression"], ["effect declaration", "declaredProgram"]
]) {
  const observe = (factory) => {
    const p = factory(1)
    return [Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]
  }
  const expected = observe(twin[name])
  assert.deepEqual(expected, [2, 3, 4])
  const actual = observe(program[name])
  assert.deepEqual(actual, expected, label)
  console.log(label, JSON.stringify(actual))
}

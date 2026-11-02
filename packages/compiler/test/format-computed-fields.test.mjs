import assert from "node:assert/strict"
import { test } from "node:test"
import { formatSource } from "../format.mjs"

const cases = [
  ["error receiver grouping", "error E { [(keys).value]: number }", "[(keys).value]"],
  ["nested receiver grouping", "type E = { [(keys.nested).value]: number }", "[(keys.nested).value]"],
  ["error payload", "error E { [(key)]: number }", "[(key)]"],
  ["error payload beside method", "error E { [((keys.value))]: number; read() { return 1 } }", "[((keys.value))]"],
  ["type member", "type E = { [(key)]: number }", "[(key)]"],
  ["interface member", "interface E { [(keys.value)]: number }", "[(keys.value)]"],
  ["returned type member", "function f(): { [(key)]: number } { return {} }", "[(key)]"],
  ["embedded module type member", "module native { export type E = { [(key)]: number } }", "[(key)]"],
]
for (const [name, source, grouped] of cases) {
  for (const lineWidth of [40, 120]) {
    test(`formatting keeps computed key grouping: ${name}, width ${lineWidth}`, () => {
      const style = { quoteStyle: "alwaysDouble", lineWidth }
      const once = formatSource(source, "key.vibe", style)
      assert.ok(once.includes(grouped), once)
      assert.equal(formatSource(once, "key.vibe", style), once)
    })
  }
}

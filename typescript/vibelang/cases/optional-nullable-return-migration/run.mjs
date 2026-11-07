import assert from "node:assert/strict"
import { Effect } from "effect"
import * as before from "./out/before.js"
import * as after from "./out/main.js"
import { boom, events, value } from "./out/lib.js"

const saved = Object.getOwnPropertyDescriptor(globalThis, "RangeError")
Object.defineProperty(globalThis, "RangeError", {
  configurable: true,
  get() { events.push("class"); return saved.value }
})
try {
  const observe = (fn) => {
    events.length = 0
    const program = fn()
    const cold = events.length === 0
    const exit = Effect.runSyncExit(program)
    return { exit, cold, events: [...events] }
  }
  const pairs = ["valueResult", "emptyResult", "thrownResult", "absentResult"].map((name) => [observe(before[name]), observe(after[name])])
  const reason = (result) => result.exit.cause.reasons[0]
  const actual = {
    successIdentity: pairs[0].every((x) => x.exit.value === value),
    nullableIdentity: pairs[1].every((x) => x.exit.value === undefined),
    defectIdentity: pairs[2].every((x) => reason(x)._tag === "Die" && reason(x).defect === boom),
    optionalArguments: pairs[3].every((x) => x.exit.value === undefined && x.events.length === 0),
    cold: pairs.flat().every((x) => x.cold),
    order: pairs.every(([a, b]) => JSON.stringify(a.events) === JSON.stringify(b.events))
  }
  assert.ok(Object.values(actual).every(Boolean), JSON.stringify(actual))
  console.log(JSON.stringify(actual))
} finally {
  Object.defineProperty(globalThis, "RangeError", saved)
}

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
  const a = observe(before.markerResult)
  const b = observe(after.markerResult)
  const c = observe(before.knownResult)
  const d = observe(after.knownResult)
  const reason = (result) => result.exit.cause.reasons[0]
  const actual = {
    successIdentity: a.exit.value === value && b.exit.value === value,
    defectIdentity: reason(c)._tag === "Die" && reason(d)._tag === "Die" && reason(c).defect === boom && reason(d).defect === boom,
    cold: [a, b, c, d].every((x) => x.cold),
    order: JSON.stringify(a.events) === JSON.stringify(b.events) && JSON.stringify(c.events) === JSON.stringify(d.events)
  }
  console.log(JSON.stringify(actual))
} finally {
  Object.defineProperty(globalThis, "RangeError", saved)
}

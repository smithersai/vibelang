// expect-result: {"one":{"kind":"ok","value":7},"two":{"kind":"ok","value":9},"failure":"Failure","late":0}
import { Effect } from "effect"
import { event, clock, observed } from "./lib.js"
export const main = () => Effect.gen(function* () {
  const one = yield* event(false)
  const two = yield* clock()
  const before = observed.length
  const failure = yield* Effect.result(event(true))
  return { one, two, failure: failure._tag, late: observed.length - before }
})

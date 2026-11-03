import { Effect } from "effect"
import { createProbe } from "./probe.js"

export function main() {
  return Effect.gen(function* () {
    const probe = createProbe()
    const program = Effect.gen(function* () {
      const source = [
        probe.factory("head"),
        ...probe.spread("left", true),
        (probe.factory("middle")),
        ...probe.spread("empty", false),
        ...probe.spread("right", true),
        probe.factory("tail")
      ]
      const exits = yield* Effect.all(source.map(Effect.exit), { concurrency: "unbounded" })
      return exits.map(x => x._tag === "Success" ? x.value : "failure")
    })
    const cold = probe.events.length === 0
    const firstValues = yield* program
    const first = { values: firstValues, events: probe.take() }
    const secondValues = yield* program
    return { cold, first, second: { values: secondValues, events: probe.take() } }
  })
}

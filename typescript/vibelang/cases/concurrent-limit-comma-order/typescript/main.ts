import { Effect } from "effect"
export function main(): Effect.Effect<number[]> {
  return Effect.gen(function* () {
    const events: number[] = []
    function mark(n: number) { events.push(n); return 1 }
    const limit = (mark(1), mark(2), 1)
    yield* Effect.forEach([3], n => Effect.sync(() => { events.push(n) }), { concurrency: limit, discard: true })
    return events
  })
}

import { Effect } from "effect"
export function main() {
  return Effect.gen(function*() {
    const seen: number[] = []
    yield* Effect.forEach([1, 2], x => Effect.sync(() => { seen.push(x) }), { concurrency: "unbounded", discard: true })
    const limit1 = 1, items1 = [3, 4]
    yield* Effect.forEach(items1, x => Effect.sync(() => { seen.push(x) }), { concurrency: limit1, discard: true })
    yield* Effect.forEach([5, 6], x => Effect.sync(() => { seen.push(x) }), { concurrency: "unbounded", discard: true })
    const limit2 = 1, items2 = [7, 8]
    yield* Effect.forEach(items2, x => Effect.sync(() => { seen.push(x) }), { concurrency: limit2, discard: true })
    return seen
  })
}

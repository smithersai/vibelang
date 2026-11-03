import { Effect } from "effect"
export function main() { return Effect.gen(function* () {
  let a = 0, b = 0
  yield* Effect.forEach([1,2], x => Effect.sync(() => { a += x }), { concurrency: "unbounded", discard: true })
  yield* Effect.forEach([1,2], x => Effect.sync(() => { b += x }), { concurrency: 2, discard: true })
  return [a,b]
}) }

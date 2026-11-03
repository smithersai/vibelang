import { Effect } from "effect"
export const collect = () => Effect.gen(function* () {
  const seen: number[] = []
  const result = yield* Effect.forEach([1, 2, 3], n => Effect.sync(() => { seen.push(n) }), { concurrency: 1, discard: true })
  return { kind: typeof result, seen }
})

export const empty = () => Effect.forEach([1], () => Effect.void, { concurrency: 1, discard: true })

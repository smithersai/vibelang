import { Effect } from "effect"
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  const out: number[] = []
  for (const limit of [-1, 0, 0.5, 1, 2, 2.5, Infinity] as const) {
    let count = 0
    yield* Effect.forEach([1, 2, 3], n => Effect.sync(() => { count += n }), { concurrency: limit, discard: true })
    let active = 0, peak = 0
    yield* Effect.forEach([1, 2, 3], n => Effect.gen(function* () {
      active++; peak = Math.max(peak, active)
      yield* Effect.yieldNow
      active--
    }), { concurrency: limit, discard: true })
    out.push(count, peak)
  }
  const xs = [1, 2]
  xs[Symbol.iterator] = function* (): Generator<number, undefined, unknown> { yield 99; return undefined }
  yield* Effect.forEach(xs, x => Effect.sync(() => { out.push(x) }), { concurrency: 1, discard: true })
  yield* Effect.forEach(xs, x => Effect.sync(() => { out.push(x) }), { concurrency: 2, discard: true })
  yield* Effect.forEach([{ n: 4 }, { n: 5 }], item => Effect.gen(function* () {
    let { n } = item
    n += 10
    if (n === 14) return
    out.push(n)
  }), { concurrency: "unbounded", discard: true })
  return out
 })
}

import { Effect, Stream } from "effect"
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  const seen: number[] = []
  yield* Stream.runForEachWhile(Stream.make([1], [2], [3], [4]), item => Effect.gen(function* () {
    let [n] = item
    n += 10
    if (n === 12) return true
    if (n === 14) return false
    seen.push(n)
    return true
  }))
  yield* Stream.runForEachWhile(Stream.make({ n: 20 }, { n: 30 }), ({ n }) => Effect.sync(() => { seen.push(n); return true }))
  return seen
 })
}

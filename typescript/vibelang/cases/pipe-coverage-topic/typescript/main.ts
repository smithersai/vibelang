import { Effect, pipe } from "effect"
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  const trace: number[] = []
  function first() { trace.push(1); return 3 }
  function next(n: number) { trace.push(n); return n + 1 }
  const t1 = first()
  const t2 = next(t1)
  const value = next(t2 + t2)
  const plain = pipe(2, next, next)
  return [value, plain, ...trace]
 })
}

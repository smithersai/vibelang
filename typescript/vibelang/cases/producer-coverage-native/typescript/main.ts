import { Effect } from "effect"
export function main(): Effect.Effect<Array<number | undefined>> {
 return Effect.gen(function* () {
  function* native() { yield 3; return 4 }
  const g = native()
  const a = g.next().value, b = g.next().value
  const total = yield* Effect.promise(async () => {
    async function* values() { yield 1; yield 2 }
    let sum = 0
    for await (const n of values()) sum += n
    return sum
  })
  return [a,b,total]
 })
}

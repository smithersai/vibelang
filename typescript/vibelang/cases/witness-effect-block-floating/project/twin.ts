import { Console, Effect } from "effect"

export const main = Effect.fn(function* (n: number) {
  Effect.gen(function* () { return 1 })
  return n
})

Effect.gen(function* () {
  yield* Console.log("never")
  yield* Console.log("runs")
})

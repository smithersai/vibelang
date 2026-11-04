import { Effect, Stream } from "effect"
export function main() {
 return Effect.gen(function* () {
  const { x = yield* Effect.succeed(7) } = {} as {x?: number}
  const [y = yield* Effect.succeed(8)] = [] as number[]
  return { x, y, values: yield* Stream.runCollect(Stream.fromIterable([9, 7])) }
 })
}

import { Effect, Stream } from "effect"
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  const methods = { items() { return Stream.make(3) } }
  class Box { items() { return Stream.make(4) } }
  return [...(yield* Stream.runCollect(methods.items())), ...(yield* Stream.runCollect(new Box().items()))]
 })
}

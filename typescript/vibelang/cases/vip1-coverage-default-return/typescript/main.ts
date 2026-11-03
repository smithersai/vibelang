import { Effect, Stream } from "effect"
function f() { return Effect.succeed(9) }
function p() { return Stream.empty }
export function main(): Effect.Effect<readonly [number, readonly number[]]> {
  return Effect.gen(function* () {
    return [yield* f(), yield* Stream.runCollect(p())] as const
  })
}

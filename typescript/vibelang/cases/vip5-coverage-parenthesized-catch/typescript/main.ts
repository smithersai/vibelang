import { Effect } from "effect"
export function main(): Effect.Effect<number> { return Effect.gen(function* () {
  return yield* Effect.catch(yield* Effect.succeed(Effect.fail("inner")), (e: string) => Effect.succeed(e.length))
}) }

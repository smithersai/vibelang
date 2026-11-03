import { Effect } from "effect"
export function main(): Effect.Effect<number> { return Effect.gen(function* () {
  let assigned: number = 0
  assigned = yield* Effect.catch(yield* Effect.catch(Effect.fail("first"), () => Effect.succeed(Effect.fail("second"))), (e: string) => Effect.succeed(e.length))
  return assigned
}) }

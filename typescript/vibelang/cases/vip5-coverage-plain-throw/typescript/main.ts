import { Effect } from "effect"
export function main(): Effect.Effect<number,unknown> { return Effect.gen(function* () {
  return yield* Effect.catch(Effect.fail("plain"), (e: string) => Effect.succeed((() => { throw e })()))
}) }

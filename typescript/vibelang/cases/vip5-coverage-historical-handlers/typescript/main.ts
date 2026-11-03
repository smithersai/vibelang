import { Effect } from "effect"
const fallback = () => 7
export function main(): Effect.Effect<readonly unknown[]> { return Effect.gen(function* () {
  const value = yield* Effect.catch(Effect.fail("x"), () => Effect.succeed(7))
  const named = yield* Effect.catch(Effect.fail("x"), () => Effect.succeed(fallback))
  const block = yield* Effect.catch(Effect.fail("x"), () => Effect.gen(function* () { return 9 }))
  const asyncValue = yield* Effect.catch(Effect.fail("x"), () => Effect.succeed((async () => 10)()))
  return [value,named === fallback,block,typeof asyncValue.then === "function"]
}) }

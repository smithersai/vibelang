// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 const left = yield* Effect.catch(yield* Effect.catch(Effect.fail("a"), () => Effect.succeed(Effect.fail("b"))), () => Effect.succeed(7))
 const nested = yield* Effect.catch(Effect.fail("a"), () => Effect.gen(function* () { return yield* Effect.catch(Effect.fail("b"), () => Effect.succeed(8)) }))
 const grouped = yield* Effect.catch(yield* Effect.succeed(Effect.fail("a")), () => Effect.succeed(9))
 return [left, nested, grouped]
}) }

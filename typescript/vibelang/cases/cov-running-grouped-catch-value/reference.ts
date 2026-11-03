// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 return (yield* Effect.catch(Effect.fail("bad"), function() { return Effect.succeed(7) })).toString()
}) }

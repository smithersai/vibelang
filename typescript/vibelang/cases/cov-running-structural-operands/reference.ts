// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 const a = yield* Exit.succeed(8)
 const b = yield* Config.succeed(7)
 return a + b
}) }

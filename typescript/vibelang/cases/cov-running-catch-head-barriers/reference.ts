// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
function boxed(n: number) { return Effect.fail(String(n)) }
export function main() { return Effect.gen(function* () {
 const a = yield* Effect.catch(boxed(yield* Effect.succeed(1)), e => Effect.succeed(e))
 const b = yield* Effect.catch(Effect.succeed([yield* Effect.succeed(2)]), () => Effect.succeed([0]))
 const c = yield* Effect.catch(Effect.succeed({n: yield* Effect.succeed(3)}), () => Effect.succeed({n: 0}))
 const d = yield* Effect.catch(Effect.succeed(`n${yield* Effect.succeed(4)}`), () => Effect.succeed(""))
 return [a, b[0], c.n, d]
}) }

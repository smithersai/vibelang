// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 const guest = "guest"
 const arrow = yield* Effect.catch(Effect.fail("bad"), e => Effect.succeed(e.length))
 const parenthesized = yield* Effect.catch(Effect.fail("bad"), e => Effect.succeed(e.length))
 const ignored = yield* Effect.catch(Effect.fail("bad"), () => Effect.succeed(guest))
 const expression = yield* Effect.catch(Effect.fail("bad"), function(e) { return Effect.succeed(e.length) })
 const effectArrow = yield* Effect.catch(Effect.fail("bad"), e => Effect.gen(function* () { return yield* Effect.succeed(e.length) }))
 const effectExpression = yield* Effect.catch(Effect.fail("bad"), function(e) { return Effect.gen(function* () { return e.length }) })
 return [arrow, parenthesized, ignored, expression, effectArrow, effectExpression]
}) }

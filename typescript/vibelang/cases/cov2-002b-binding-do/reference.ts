import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 const { x = yield* Effect.succeed(7) } = {} as {x?: number}
 const early = yield* Effect.gen(function* () { return 9 })
 return { x, early }
}) }

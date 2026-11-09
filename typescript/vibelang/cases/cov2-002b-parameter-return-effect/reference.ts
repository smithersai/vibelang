import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
function early(x: number | undefined = undefined) { if (x === undefined) return Effect.succeed(7 as const); return Effect.succeed(0 as const) }
export function main() { return Effect.gen(function* () { return yield* early() }) }

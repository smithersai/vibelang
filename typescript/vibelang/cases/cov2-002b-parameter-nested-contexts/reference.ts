import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main(a = async () => await Promise.resolve(7), b = function* () { yield 7 }) { return Effect.succeed(0) }

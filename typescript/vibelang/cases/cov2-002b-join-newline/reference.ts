import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () { const a = yield* Effect.forkChild(Effect.succeed(7)); return yield* Fiber.join(a) }) }

import { Effect, Schema } from "effect"

export const decode = Schema.decodeUnknownEffect(Schema.String)
export const run = (n: number): Effect.Effect<number> => Effect.succeed(n)

import * as Effect from "effect/Effect"

export type Maybe = Effect.Effect<string, never, never> | number
export type Programs = ReadonlyArray<Effect.Effect<number, never, never> | undefined>
export type Either = Effect.Effect<string, never, never> | Effect.Effect<number, Error, never>

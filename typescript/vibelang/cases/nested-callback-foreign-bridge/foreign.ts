import type * as Effect from "effect/Effect"
export const make = <R>(options: {execute: (sql: string) => Effect.Effect<string, never, R>}) => options

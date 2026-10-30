import { Effect } from "effect"
export type T = Effect.Effect<number, { readonly x: 1 }>
export type Full = Effect.Effect<number, { readonly x: 1 }, never>
export type Empty = Effect.Effect<number, {}>

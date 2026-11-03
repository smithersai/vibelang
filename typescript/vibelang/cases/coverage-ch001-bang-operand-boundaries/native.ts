import { Effect } from "effect"
export type Required = Effect.Effect<number, { reason: string }, { service: number }>
export type Optional = Effect.Effect<number, never, { service: number }>
export type Negative = Effect.Effect<number, never, -1>
type as = { service: number }; type satisfies = { other: string }
export type Named = Effect.Effect<number, never, as>
export type Other = Effect.Effect<number, string, satisfies>
export function f(x: unknown) {
 const a = x as Effect.Effect<number> as unknown
 const b = x as Effect.Effect<number> satisfies unknown
 const c = x as Effect.Effect<number, never, as> satisfies unknown
 const d = x as Effect.Effect<number, never, [0]>
 return [a,b,c,d]
}


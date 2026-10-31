import { Effect } from "effect"
export type ErrorOnly = Effect.Effect<number, { readonly x: 1 }>
export type Full = Effect.Effect<number, { readonly x: 1 }, never>
export type Empty = Effect.Effect<number, {}>
export type Requirement = Effect.Effect<number, string, { readonly service: number }>
export type Both = Effect.Effect<number, { readonly x: 1 }, { readonly service: number }>
export type Method = { read(): Effect.Effect<number, { readonly x: 1 }, { readonly service: number }> }
export type Callable = () => Effect.Effect<number, { readonly x: 1 }, { readonly service: number }>
export type OptionalRequirement = Effect.Effect<number, never, { readonly service: number }>
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Check<T extends true> = T
export type Proof = [
 Check<Same<ErrorOnly, Effect.Effect<number, { readonly x: 1 }, never>>>,
 Check<Same<Full, Effect.Effect<number, { readonly x: 1 }, never>>>,
 Check<Same<Empty, Effect.Effect<number, {}, never>>>,
 Check<Same<Requirement, Effect.Effect<number, string, { readonly service: number }>>>,
 Check<Same<Both, Effect.Effect<number, { readonly x: 1 }, { readonly service: number }>>>,
 Check<Same<Method, { read(): Effect.Effect<number, { readonly x: 1 }, { readonly service: number }> }>>,
 Check<Same<Callable, () => Effect.Effect<number, { readonly x: 1 }, { readonly service: number }>>>,
 Check<Same<OptionalRequirement, Effect.Effect<number, never, { readonly service: number }>>>
]
export function legacy(): Effect.Effect<number, string> { return Effect.gen(function* () { return 1 }) }
export function legacyEmptyError(): Effect.Effect<number> { return Effect.gen(function* () { return 2 }) }
export function main() { return Effect.gen(function* () { return [yield* legacy(), yield* legacyEmptyError()] }) }

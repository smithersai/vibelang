import { Effect } from "effect"
import type { Scope } from "effect"
export interface A { readonly a: number }
export interface B { readonly b: number }
export type ScopeA = Scope.Scope | A
export type BrandedScope = Scope.Scope & { readonly brand: "scope" }
export const union: Effect.Effect<number, never, Scope.Scope | A> = Effect.succeed(7)
export const twoServices: Effect.Effect<number, never, Scope.Scope | A | B> = Effect.succeed(7)
export const alias: Effect.Effect<number, never, ScopeA> = Effect.succeed(7)
export const intersection: Effect.Effect<number, never, Scope.Scope & A> = Effect.succeed(7)
export const branded: Effect.Effect<number, never, BrandedScope> = Effect.succeed(7)
export const services: Effect.Effect<number, never, A | B> = Effect.succeed(7)
export const scopeOnly: Effect.Effect<number, never, Scope.Scope> = Effect.succeed(7)
export const unknownR: Effect.Effect<number, never, unknown> = Effect.succeed(7)
export const anyR: Effect.Effect<number, never, any> = Effect.succeed(7)
export const neverR: Effect.Effect<number, never, never> = Effect.succeed(7)

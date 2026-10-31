// A TypeScript module that stays TypeScript. Nothing says what most of its functions throw.
import { Effect } from "effect"
import { Hidden } from "./errors.ts"

export const double = (n: number): number => n * 2
export const refuse = (n: number): number => {
  if (n < 0) throw new RangeError("negative")
  return n
}
export const label = (name: string, n: number): string => name + "=" + n
export const box = (n: number): { readonly value: number } => ({ value: n })
export const program = (n: number): Effect.Effect<number> => Effect.succeed(n)
export const project = <S>(options: { readonly reduce: (state: S) => Effect.Effect<S> }) => options

/**
 * @vibelang trusted
 * @throws {Hidden}
 */
export const guarded = (n: number): number => {
  if (n < 0) throw new Hidden("hidden")
  return n
}

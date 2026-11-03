import { Effect } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type as = unknown
type B = unknown
declare const B: unknown
declare const x: unknown
function continuation() {
  const a = x as Effect.Effect<number> as B
  const b = x as Effect.Effect<number> satisfies unknown
  const c = x as Effect.Effect<number, never, as> satisfies unknown
  x as Effect.Effect<number, never, as>
  B
  return [a, b, c]
}
type Present = Effect.Effect<number, never, as>
export const check: Equal<Present, Effect.Effect<number, never, as>> = true
export function main(): Effect.Effect<number> { return Effect.succeed(1) }

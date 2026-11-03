// Native wrapper control: tsc 5.9.3, Effect 4.1.0. The catch-head
// restriction is VIP-5 syntax; these wrappers keep native TypeScript checks.
import { Effect } from "effect"
declare const nested: Effect.Effect<Effect.Effect<number, string>, string>
export function reference() {
  return Effect.gen(function* () {
    const a = (yield* nested) as Effect.Effect<number, string>
    const b = <Effect.Effect<number, string>>(yield* nested)
    const c = (yield* nested) satisfies Effect.Effect<number, string>
    const d = (yield* nested)!
    return [a, b, c, d]
  })
}

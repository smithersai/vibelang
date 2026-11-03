import { Effect } from "effect"
function witness(x: unknown) {
 const asserted: unknown = x as Effect.Effect<number> as unknown
 const checked: Effect.Effect<number> = x as Effect.Effect<number> satisfies unknown
}
export function main() { return Effect.gen(function* () { return 1 }) }

import { Effect } from "effect"
function witness(x: unknown) {
 const chosen = x as Effect.Effect<number> ? 1 : 2
 // @ts-expect-error: Effect values are not arithmetic operands
 const product = (x as Effect.Effect<number>) * 2
}
export function main() { return Effect.gen(function* () { return 1 }) }

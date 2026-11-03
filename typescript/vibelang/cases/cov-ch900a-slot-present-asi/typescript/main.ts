import { Effect } from "effect"
type as = { service: number }
function witness(x: unknown, B: unknown) {
 const y = x as Effect.Effect<number,never,as>
 B
 const check: Effect.Effect<number,never,as> = y
 return check
}
export function main() { return Effect.gen(function* () { return 1 }) }

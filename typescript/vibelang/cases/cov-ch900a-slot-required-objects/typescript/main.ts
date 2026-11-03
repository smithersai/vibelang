import { Effect } from "effect"
type Actual = Effect.Effect<number, { reason: string }, { service: number }>
type Same<X,Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
const equal: Same<Actual, Effect.Effect<number, { reason: string }, { service: number }>> = true
export function main() { return Effect.gen(function* () { return 1 }) }

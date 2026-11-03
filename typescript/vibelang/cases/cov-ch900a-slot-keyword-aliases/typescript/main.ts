import { Effect } from "effect"
type as = { service: number }
type satisfies = { other: string }
type A = Effect.Effect<number,never,as>
type B = Effect.Effect<number,string,satisfies>
type C = Effect.Effect<number,never,satisfies>
type Same<X,Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
const a: Same<A, Effect.Effect<number,never,as>> = true
const b: Same<B, Effect.Effect<number,string,satisfies>> = true
const c: Same<C, Effect.Effect<number,never,satisfies>> = true
function witness(x: unknown) { const n: A = x as Effect.Effect<number,never,as> satisfies unknown }
export function main() { return Effect.gen(function* () { return 1 }) }

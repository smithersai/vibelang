import { Effect } from "effect"
type A = [Effect.Effect<number,string>?]
type B = [Effect.Effect<number>?]
type C = [Effect.Effect<number,never,-1>?]
type Same<X,Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
const a: Same<A, [Effect.Effect<number,string>?]> = true
const b: Same<B, [Effect.Effect<number>?]> = true
const c: Same<C, [Effect.Effect<number,never,-1>?]> = true
export function main() { return Effect.gen(function* () { return 1 }) }

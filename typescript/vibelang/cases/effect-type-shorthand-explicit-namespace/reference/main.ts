import { Effect } from "effect"
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
export const alias: Equal<Effect.Effect<number>, Effect.Effect<number>> = true
export function main(): Effect.Effect<number> { return Effect.succeed(1) }

import { Effect } from "effect"
function witness(x: unknown) {
 const compact: Effect.Effect<number, never, -1> = x as Effect.Effect<number, never, -1>
 const spaced: Effect.Effect<number, never, -1> = x as Effect.Effect<number, never, -1>
 // @ts-expect-error: Effect values are not arithmetic operands
 const subtract = (x as Effect.Effect<number>) - 1
}
export function main() { return Effect.gen(function* () { return 1 }) }

import { Effect } from "effect"
export const typed = (x: number) => Effect.succeed(x + 1)
export const generic = <T>(x: T) => Effect.succeed(x)
function effect(value: number): number { return value * 2 }
const ordinary = (effect: number): number => effect + 1
export const program = () => Effect.gen(function*() {
  return [yield* typed(3), yield* generic("ok"), effect(3), ordinary(7)]
})

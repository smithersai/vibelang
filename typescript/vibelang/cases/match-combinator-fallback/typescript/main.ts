import { Effect } from "effect"
export function choose(x: boolean): 0 | 1 {
  if (x === true && x === true) return 1
  if (x === false) return 0
  throw new TypeError()
}
export function effectChoose(x: boolean): Effect.Effect<0 | 1, never, never> {
  return Effect.gen(function* () {
    if (x === true && x === true) return 1
    if (x === false) return 0
    throw new TypeError()
  })
}

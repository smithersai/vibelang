import { Effect } from "effect"
export function choose(value: boolean): 1 {
  if (value === true) return 1 as const
  throw new TypeError()
}
export async function asyncChoose(value: boolean): Promise<1> {
  if (value === true) return 1 as const
  throw new TypeError()
}
export function effectChoose(value: boolean): Effect.Effect<1, never, never> {
  return Effect.gen(function* () {
    if (value === true) return 1 as const
    throw new TypeError()
  })
}

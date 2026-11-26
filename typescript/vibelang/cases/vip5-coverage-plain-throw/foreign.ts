import { Effect } from "effect"

export function defect(e: string): Effect.Effect<never> {
  return Effect.sync(() => { throw e })
}

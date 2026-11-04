import { Effect } from "effect"
export function main(): Effect.Effect<unknown> {
  return Effect.gen(function* () { return 7 })
}

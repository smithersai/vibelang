import { Effect } from "effect"
const effect = 2
const typed = effect as number
const checked = effect satisfies number
const matched = effect === 2
export function main(): Effect.Effect<readonly [number, number, boolean]> {
  return Effect.succeed([typed, checked, matched] as const)
}

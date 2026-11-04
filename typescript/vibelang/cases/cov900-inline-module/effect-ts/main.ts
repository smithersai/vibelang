import { Effect } from "effect"
import { clean } from "./text.js"
export function normalized(value: string) {
  return Effect.gen(function* () {
    return yield* Effect.try(() => clean(value))
  })
}
export function main() {
  return Effect.gen(function* () {
    return yield* normalized(" module ")
  })
}

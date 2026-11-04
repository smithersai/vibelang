import { Effect } from "effect"
export function main(): Effect.Effect<unknown> {
  return Effect.gen(function* () {
    let calls = 0
    const subject = ++calls
    let value: number
    if (subject === 0) value = 0
    else if (subject === 1) { yield* Effect.yieldNow; value = 7 }
    else value = -1
    return [calls, value]
  })
}

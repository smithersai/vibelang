import { Effect } from "effect"
export function ordinary(value: any): string { return value }
export function main(value = 7, reason = "intended") {
  return Effect.gen(function* () {
    const result = yield* Effect.succeed(value)
    const intended = yield* Effect.succeed(ordinary(reason))
    if (result < 0) return yield* Effect.fail(intended)
    return result
  })
}

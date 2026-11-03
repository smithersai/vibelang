import { Effect, Exit } from "effect"
import { iterable } from "./foreign.js"
function unknownValue(x: unknown): number { if (x === "one") return 1; throw new TypeError("no matching arm") }
export function main(): Effect.Effect<readonly unknown[],unknown> { return Effect.gen(function* () {
  const noMatch = yield* Effect.exit(Effect.sync(() => unknownValue("other")))
  const iteration = yield* Effect.exit(Effect.sync(() => Array.from(iterable())))
  return [
    Exit.isFailure(noMatch) && noMatch.cause.reasons[0]?._tag === "Die" && noMatch.cause.reasons[0].defect instanceof TypeError,
    Exit.isFailure(iteration) && iteration.cause.reasons[0]?._tag === "Die" && iteration.cause.reasons[0].defect === "iterator"
  ]
}) }

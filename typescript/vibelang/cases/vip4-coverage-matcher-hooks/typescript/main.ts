import { Effect, Exit } from "effect"
import { GetterPattern, CallPattern, matcher } from "./foreign.js"
function read(x: unknown) { return GetterPattern[matcher](x) ? 1 : 0 }
function call(x: unknown) { return CallPattern[matcher](x) ? 1 : 0 }
export function main(): Effect.Effect<readonly unknown[]> { return Effect.gen(function* () {
  const getter = yield* Effect.exit(Effect.sync(() => read({})))
  const called = yield* Effect.exit(Effect.sync(() => call({})))
  return [
    Exit.isFailure(getter) && getter.cause.reasons[0]?._tag === "Die" && getter.cause.reasons[0].defect === "getter",
    Exit.isFailure(called) && called.cause.reasons[0]?._tag === "Die" && called.cause.reasons[0].defect === "call"
  ]
}) }

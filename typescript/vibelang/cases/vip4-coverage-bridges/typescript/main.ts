import { Effect, Exit } from "effect"
import { foreign, foreignAsync, reset, count } from "./foreign.js"
export function identity(n: number): Effect.Effect<number> {
  return Effect.gen(function* () { return yield* Effect.orDie(Effect.try({ try: () => foreign(n), catch: (error) => error })) })
}
export function main(): Effect.Effect<readonly unknown[], unknown> { return Effect.gen(function* () {
  reset()
  const held = Effect.try({ try: () => foreign(-1), catch: (error) => error })
  const asyncHeld = Effect.tryPromise({ try: () => foreignAsync(-1), catch: (error) => error })
  const cold = count()
  const failed = yield* Effect.exit(held)
  const asyncFailed = yield* Effect.exit(asyncHeld)
  const defect = yield* Effect.exit(identity(-1))
  const wrapped = yield* Effect.exit(Effect.orDie(Effect.try(() => foreign(-1))))
  const success = yield* Effect.try(() => foreign(8))
  const promiseSuccess = yield* Effect.tryPromise(() => foreignAsync(9))
  const failureValue = Exit.isFailure(failed) && failed.cause.reasons[0]?._tag === "Fail" && failed.cause.reasons[0].error === "foreign"
  const asyncValue = Exit.isFailure(asyncFailed) && asyncFailed.cause.reasons[0]?._tag === "Fail" && asyncFailed.cause.reasons[0].error === "async"
  const original = Exit.isFailure(defect) && defect.cause.reasons[0]?._tag === "Die" && defect.cause.reasons[0].defect === "foreign"
  const changed = Exit.isFailure(wrapped) && wrapped.cause.reasons[0]?._tag === "Die" && wrapped.cause.reasons[0].defect !== "foreign"
  return [cold, count(), failureValue, asyncValue, original, changed, success, promiseSuccess]
}) }

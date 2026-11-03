import { Cause, Data, Effect, Exit, Schema } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
class Invalid extends Schema.TaggedError<Invalid>()("Invalid", { name: Schema.NonEmptyString }) {}
function fail(): Effect.Effect<never, Invalid> {
  return Effect.gen(function* () { return yield* Effect.fail(new Invalid({ name: "" })) })
}
export const contract: Equal<ReturnType<typeof fail>, Effect.Effect<never, Invalid>> = true
export function main() {
  return Effect.gen(function* () {
    const result = yield* Effect.exit(fail())
    return [Exit.isFailure(result), Exit.isFailure(result) && result.cause.reasons.every(r => r._tag === "Die"), Exit.isFailure(result) && Cause.squash(result.cause) instanceof Error]
  })
}

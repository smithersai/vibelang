import { Effect, Schema, Exit, Cause } from "effect"
export const reference = Effect.gen(function* () {
  const heritage = yield* Effect.exit(Effect.gen(function* () {
    class C extends JSON.parse("invalid") {}
    return 1
  }))
  const key = yield* Effect.exit(Effect.gen(function* () {
    class E extends Schema.TaggedError<E>()("E", { value: Schema.Struct({ [JSON.parse("invalid")]: Schema.String }) }) {}
    return 1
  }))
  return { heritage: Exit.isFailure(heritage) && Cause.hasDies(heritage.cause) && Cause.squash(heritage.cause) instanceof SyntaxError, key: Exit.isFailure(key) && Cause.hasDies(key.cause) && Cause.squash(key.cause) instanceof SyntaxError }
})

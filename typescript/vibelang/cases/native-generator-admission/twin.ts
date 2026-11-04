import { Effect, Schema, Stream } from "effect"
class Invalid extends Schema.TaggedError<Invalid>()("Invalid", { name: Schema.NonEmptyString }) {}
export function nativeNumbers() { return [1, 2] }
export function* values() { yield 1; yield 2; return 3 }
export function program() {
  return Effect.gen(function* () { return yield* Effect.succeed(7) })
}
export function invalid() {
  return Effect.gen(function* () {
    return yield* Effect.fail(new Invalid({ name: "" }))
  })
}

export function streamValues() { return Stream.make(1, 2) }

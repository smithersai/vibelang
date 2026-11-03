import { Cause, Data, Effect, Exit, Schema } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const error = Schema.String
type error = typeof error.Type
class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {}) {}
class Missing extends Schema.TaggedError<Missing>()("Missing", { id: Schema.String }) {}
export function main() {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(error)("ordinary alias")
    return [decoded, new Timeout()._tag, new Missing({ id: "x" }).id]
  })
}

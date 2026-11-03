// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
class Missing extends Data.TaggedError("Missing")<{ readonly id: string }> {}
export function main() { return Effect.gen(function* () {
 const result = yield* Effect.exit(Effect.gen(function* () { return yield* new Missing({ id: "a" }) }))
 return result._tag === "Failure" ? result.cause.reasons.map(r => r._tag === "Fail" ? r.error._tag : r._tag) : []
}) }

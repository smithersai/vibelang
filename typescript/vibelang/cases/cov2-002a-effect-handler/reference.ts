import { Effect } from "effect"
export function main() { return Effect.gen(function* () {
 const outcome = yield* Effect.exit(Effect.gen(function* () { return yield* Effect.catch(Effect.fail("first"), e => Effect.gen(function* () { const s = yield* Effect.succeed(e + ":second"); return yield* Effect.fail(s) })) }))
 return outcome._tag === "Failure" ? outcome.cause.reasons.map(r => r._tag === "Fail" ? r.error : r._tag) : ["wrong"]
}) }

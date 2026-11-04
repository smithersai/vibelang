import { Data, Effect } from "effect"
class NotFound extends Data.TaggedError("NotFound") {}
class Present extends Data.TaggedError("Present")<{ readonly state: string }> {}
export const trace: string[] = []
const describe = (missing: boolean): Effect.Effect<{ state: string }, NotFound> => {
  trace.push("describe:construct")
  return Effect.suspend(() => {
    trace.push("describe:run")
    return missing ? Effect.fail(new NotFound()) : Effect.succeed({ state: "active" })
  })
}
export const awaitGone = Effect.fn(function* (missing: boolean) {
  return yield* Effect.gen(function* () {
    const result = yield* describe(missing)
    return yield* Effect.fail(new Present({ state: result.state }))
  }).pipe(Effect.catchTag("NotFound", () => Effect.void))
})

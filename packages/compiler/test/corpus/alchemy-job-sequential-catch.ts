import { Data, Effect } from "effect"
class Forbidden extends Data.TaggedError("Forbidden") {}
class NotFound extends Data.TaggedError("NotFound") {}
export const trace: string[] = []
const request = (mode: number): Effect.Effect<number, Forbidden | NotFound> => {
  trace.push("request:construct")
  return Effect.suspend((): Effect.Effect<number, Forbidden | NotFound> => {
    trace.push("request:run")
    return mode === 0 ? Effect.succeed(7) : mode === 1 ? Effect.fail(new Forbidden()) : Effect.fail(new NotFound())
  })
}
const fallback = (fails: boolean): Effect.Effect<number, NotFound> => {
  trace.push("fallback:construct")
  return Effect.suspend(() => {
    trace.push("fallback:run")
    return fails ? Effect.fail(new NotFound()) : Effect.succeed(11)
  })
}
export const list = Effect.fn(function* (mode: number, fallbackFails: boolean) {
  return yield* request(mode).pipe(
    Effect.catchTag("Forbidden", () => fallback(fallbackFails)),
    Effect.catchTag("NotFound", () => Effect.succeed(0)),
  )
})

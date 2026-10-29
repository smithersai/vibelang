import { Data, Effect, Schedule } from "effect"

export class Timeout extends Data.TaggedError("Timeout")<{ readonly ms: number }> {}

// fetchWithRetry runs fetchOnce, retrying a Timeout twice, and upper-cases the result.
export const fetchWithRetry = (fetchOnce: () => Effect.Effect<string, Timeout>) =>
  Effect.gen(function* () {
    const value = yield* fetchOnce().pipe(Effect.retry(Schedule.recurs(2)))
    return value.toUpperCase()
  })

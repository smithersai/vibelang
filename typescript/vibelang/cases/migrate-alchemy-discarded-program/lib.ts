import { Effect } from "effect"

export let constructed = 0
export let runs = 0

export const make = Effect.fn(function* () {
  const job = Effect.sync(() => { runs++; return 99 })
  Effect.succeed(constructed++)
  job
  const values = [1, 2].map(n => { Effect.succeed(constructed++); return n })
  return yield* Effect.succeed({ values, constructed, runs })
})

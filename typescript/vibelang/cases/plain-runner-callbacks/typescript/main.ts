import { Effect } from "effect"
import { report } from "./report.ts"

export function boot() {
  return Effect.gen(function* () {
    const run = Effect.runSyncWith(yield* Effect.context<never>())
    const transform = (f: () => number) => f()
    const immediate = transform(() => run(Effect.succeed(1)))
    return [immediate, () => run(Effect.succeed(2))] as const
  })
}
const [immediate, later] = await Effect.runPromise(boot())
report([immediate, later()])

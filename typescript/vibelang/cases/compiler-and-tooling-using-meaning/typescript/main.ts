import { Effect } from "effect"
export function unsafe(resource: Disposable) { return Effect.gen(function* () { using file = resource; return yield* Effect.fail("boom") }) }

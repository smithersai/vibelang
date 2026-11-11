import { Data, Effect } from "effect"
import { nonEmpty } from "./main.vibe.check.ts"
export { nonEmpty }
class Empty extends Data.TaggedError("Empty")<{ readonly input: string }> {}
export function load(s: string) {
  return Effect.gen(function* () { return yield* Effect.try({ try: () => nonEmpty(s), catch: () => new Empty({ input: s }) }) })
}

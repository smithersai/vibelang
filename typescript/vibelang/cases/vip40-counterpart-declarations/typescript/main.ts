import { Data, Effect } from "effect"
import { port } from "./main.vibe.parse.ts"
export const early = loadPort
class BadPort extends Data.TaggedError("BadPort")<{ readonly raw: string }> {}
export function loadPort(raw: string) {
  return Effect.gen(function* () { return yield* Effect.try({ try: () => port(raw), catch: () => new BadPort({ raw }) }) })
}

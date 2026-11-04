import { Effect } from "effect"
export function main() { return Effect.gen(function* () {
 const events: string[] = []
 const value = yield* Effect.catch(Effect.gen(function* () { yield* Effect.ensuring(Effect.fail("bad"), Effect.sync(() => { events.push("close") })); return 1 }), e => Effect.succeed((events.push(e),0)))
 return [value,events]
}) }

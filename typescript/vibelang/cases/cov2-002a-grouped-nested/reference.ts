import { Effect } from "effect"
export function main() { return Effect.gen(function* () { return yield* Effect.catch(yield* Effect.succeed(Effect.fail("inner")), e => Effect.succeed(e.length)) }) }

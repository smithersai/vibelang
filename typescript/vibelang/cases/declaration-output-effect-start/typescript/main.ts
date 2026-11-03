import { Effect } from "effect"
export function start() { return Effect.gen(function* () { return yield* Effect.succeed("up") }) }

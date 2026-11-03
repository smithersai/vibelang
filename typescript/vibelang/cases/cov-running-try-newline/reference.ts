import { Effect } from "effect"
export function main() { return Effect.gen(function* () { return yield* Effect.succeed(7) }) }

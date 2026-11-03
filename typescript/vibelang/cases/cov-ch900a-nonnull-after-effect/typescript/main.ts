import { Effect } from "effect"
function cast(x: unknown) { return (x as Effect.Effect<number>)! }
export function main() { return Effect.gen(function* () { return yield* cast(Effect.succeed(1)) }) }

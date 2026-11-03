import {Effect} from "effect"
export function main(): Effect.Effect<number> { return Effect.gen(function*(){return yield* Effect.succeed(1)}) }

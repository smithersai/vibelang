import {Effect} from "effect"
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){return yield* Effect.catch(yield* Effect.succeed(Effect.fail("inner")),e=>Effect.succeed(e.length))})}

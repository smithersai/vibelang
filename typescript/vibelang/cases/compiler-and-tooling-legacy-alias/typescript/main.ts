import {Effect} from "effect"
export function main(value: Effect.Effect<number>) { return Effect.gen(function*(){ return yield* value }) }

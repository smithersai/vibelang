import { Effect } from "effect"
export function main(value: any): Effect.Effect<unknown, unknown, unknown> { return Effect.gen(function* () { return yield* value }) }

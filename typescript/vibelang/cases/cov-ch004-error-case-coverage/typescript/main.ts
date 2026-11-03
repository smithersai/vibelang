import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
return [1,1]
}) }

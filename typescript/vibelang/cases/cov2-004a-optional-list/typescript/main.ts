import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const xs: unknown[][] = [[], [undefined], [1], [1,2]]
return xs.map(s => s.length === 0 || s.length === 1 && s[0] === 1)
}) }

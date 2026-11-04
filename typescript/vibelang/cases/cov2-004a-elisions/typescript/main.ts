import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const xs: number[][] = [[9,3], [9,8,3], [], [9]]
return xs.map(s => s.length === 3 && s[2] === 3)
}) }

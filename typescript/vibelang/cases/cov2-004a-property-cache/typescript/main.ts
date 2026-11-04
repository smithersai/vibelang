import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
let reads = 0
const s = { get a() { return ++reads }, get b() { return ++reads } }
const a = s.a
return [a === 0 ? 0 : a === 1 && s.b === 2 ? 7 : -1, reads]
}) }

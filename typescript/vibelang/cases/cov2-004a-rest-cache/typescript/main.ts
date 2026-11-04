import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
let reads = 0
const s = { get value() { return ++reads } }
const value = s.value
const { ...rest } = s
return [value === 0 ? 0 : rest.value, reads]
}) }

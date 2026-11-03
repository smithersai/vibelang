import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
let calls = 0
const no = ++calls === 2
const yes = ++calls === 2
return [no,yes,calls]
}) }

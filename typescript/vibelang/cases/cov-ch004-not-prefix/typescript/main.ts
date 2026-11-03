import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
let calls = 0
function not(s: unknown): [unknown] { calls++; return [s] }
const helpers = { not }
const a = "miss"; const b = helpers.not(5).length === 1 ? "hit" : "miss"
return [a,b,"zero",calls]
}) }

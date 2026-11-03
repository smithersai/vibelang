import { Effect } from "effect"
function choose(n: number) { return n }
export function main(): Effect.Effect<number, string> { return Effect.gen(function* () {
 const n = choose(2)
 if (n === 1) return 0
 return yield* Effect.fail("bad")
}) }

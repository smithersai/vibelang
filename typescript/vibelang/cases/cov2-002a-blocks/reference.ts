import { Effect } from "effect"
export function main() { return Effect.gen(function* () {
 const a = yield* Effect.gen(function* () { let n = 0; for (let i=0;i<4;i++) { if(i===1) continue; if(i===3) break; n += i }; return yield* Effect.succeed(n) })
 const b = yield* (() => Effect.gen(function* () { return yield* Effect.succeed(2) }))()
 return [a,b]
}) }

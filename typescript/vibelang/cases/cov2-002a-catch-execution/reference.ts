import { Effect } from "effect"
export function main() { return Effect.gen(function* () {
 let n = 0
 const a = yield* Effect.catch(Effect.gen(function* () { yield* Effect.sync(() => { n += 1 }); return yield* Effect.fail("bad") }), e => Effect.succeed(0))
 const b = yield* Effect.catch(Effect.fail("bad"), e => Effect.gen(function* () { return yield* Effect.succeed(0) }))
 const c = yield* Effect.catch(Effect.succeed(7), () => { n += 100; return Effect.succeed(0) })
 return [a,b,c,n]
}) }

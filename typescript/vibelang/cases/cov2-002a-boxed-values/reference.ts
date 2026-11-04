import { Effect } from "effect"
import { values } from "./values.js"
function boxed(inner: Effect.Effect<number>) { return Effect.gen(function* () { return inner }) }
function unboxed(inner: Effect.Effect<number>) { return Effect.gen(function* () { return yield* inner }) }
export function main() { return Effect.gen(function* () {
 let runs = 0
 const inner = Effect.sync(() => { runs++; return 7 })
 const a = yield* boxed(inner)
 const b = yield* Effect.succeed(inner)
 const c = yield* Effect.catch(Effect.fail("bad"), () => Effect.succeed(inner))
 const before = runs
 const n = yield* unboxed(inner)
 const data = values()
 const promiseTry = yield* Effect.succeed(data.promise)
 const promiseReturn = yield* Effect.gen(function* () { return data.promise })
 const promiseCatch = yield* Effect.catch(Effect.fail(1), () => Effect.succeed(data.promise))
 const thenableTry = yield* Effect.succeed(data.thenable)
 const thenableReturn = yield* Effect.gen(function* () { return data.thenable })
 const thenableCatch = yield* Effect.catch(Effect.fail(1), () => Effect.succeed(data.thenable))
 return [a === inner,b === inner,c === inner,before,n,runs,promiseTry === data.promise,promiseReturn === data.promise,promiseCatch === data.promise,thenableTry === data.thenable,thenableReturn === data.thenable,thenableCatch === data.thenable,data.state.n]
}) }

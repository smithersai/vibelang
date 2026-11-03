import { Context, Effect, Layer, Deferred, Fiber } from "effect"
class Counter extends Context.Service<Counter,{value:number}>()("coverage/Fork") {}
let released=0
const Live=Layer.effect(Counter,Effect.acquireRelease(Effect.succeed({value:7}),()=>Effect.sync(()=>{released++})))
export const main=()=>Effect.gen(function* () {
 const ready=yield* Deferred.make<void>(), gate=yield* Deferred.make<void>()
 let fiber: Fiber.Fiber<number>
 yield* Effect.provide(Effect.gen(function* () {
  fiber=yield* Effect.forkChild(Effect.gen(function* () {
   yield* Deferred.succeed(ready,undefined); yield* Deferred.await(gate); return (yield* Counter).value
  }))
  yield* Deferred.await(ready)
 }),Live)
 const afterRelease=released
 yield* Deferred.succeed(gate,undefined)
 const value=yield* Fiber.join(fiber!)
 return {value,afterRelease}
})

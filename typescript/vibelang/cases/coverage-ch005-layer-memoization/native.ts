import { Context, Effect, Layer } from "effect"
class Counter extends Context.Service<Counter,{value:number}>()("coverage/Memo") {}
let built=0,released=0
const Live=Layer.effect(Counter,Effect.acquireRelease(Effect.sync(()=>({value:++built})),()=>Effect.sync(()=>{released++})))
export const main=()=>Effect.gen(function* () {
 const values:number[]=[]
 yield* Effect.provide(Effect.gen(function* () {
  values.push((yield* Counter).value)
  yield* Effect.provide(Effect.gen(function* () { values.push((yield* Counter).value) }),Live)
 }),Live)
 yield* Effect.provide(Effect.gen(function* () { values.push((yield* Counter).value) }),Live)
 return {values,built,released}
})

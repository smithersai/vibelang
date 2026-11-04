import {Effect} from "effect"
export function main():Effect.Effect<unknown[]>{
 return Effect.gen(function*(){
 const x=1
 let active=0,peak=0
 function visit(){
  return Effect.gen(function*(){
   yield* Effect.forEach([2,3,4],x=>Effect.gen(function*(){
    active++;peak=Math.max(peak,active)
    yield* Effect.yieldNow
    active--
   }),{concurrency:x,discard:true})
  })
 }
 const nothing=yield* visit()
 const kept=yield* Effect.all([Effect.succeed(2),Effect.succeed(3),Effect.succeed(4)],{concurrency:"unbounded"})
 return [nothing===undefined,kept,peak]
 })
}

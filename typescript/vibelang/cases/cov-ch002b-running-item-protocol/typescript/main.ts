import { Effect, Stream, Layer } from "effect"
function protocols(){return Effect.gen(function*(){
 const seen:number[]=[]
 yield* Stream.runForEachWhile(Stream.make(1,2,3,4),n=>Effect.gen(function*(){
   let keep=true
   yield* Effect.provide(Effect.gen(function*(){if(n===1)return;if(n===4){keep=false;return}seen.push(n)}),Layer.empty)
   return keep
 }))
 yield* Effect.forEach([1,2,3],n=>Effect.uninterruptibleMask(()=>Effect.gen(function*(){if(n===2)return;seen.push(n+10)})),{concurrency:1,discard:true})
 yield* Stream.runForEachWhile(Stream.make(1),()=>Effect.succeed(true));const a=7
 yield* Effect.forEach([1],()=>Effect.void,{concurrency:"unbounded",discard:true});const b=8
 return [seen,a,b]
})}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){return yield* protocols()})}

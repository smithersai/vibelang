import {Effect,Stream,Queue} from "effect"
class Base {value=0;set n(value:number){this.value=value};get n(){return this.value}}
class Derived extends Base {
 values(){return Stream.callback<number>(queue=>Effect.gen(()=>this.nativeBody(queue)).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:"suspend"})}
 *nativeBody(queue:Queue.Queue<number>){
  super.n=yield* Effect.gen(function*(){yield* Queue.offer(queue,9);return 7})
  yield* Queue.offer(queue,super.n)
  super.n+=yield* Effect.gen(function*(){yield* Queue.offer(queue,8);return 2})
  yield* Queue.offer(queue,super.n)
 }
}
const caseTest=()=>Stream.callback<number>(queue=>Effect.gen(function*(){switch(0){case (yield* Effect.gen(function*(){yield* Queue.offer(queue,9);return 0})):yield* Queue.offer(queue,7);break}}).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:"suspend"});
const optional=(o:{m(n:number):number}|null)=>Stream.callback<number>(queue=>Effect.gen(function*(){yield* Queue.offer(queue,o?.m((yield* Effect.gen(function*(){yield* Queue.offer(queue,9);return 7})))??0)}).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:"suspend"});
const loopTest=()=>Stream.callback<number>(queue=>Effect.gen(function*(){for(let i=0;(yield* Effect.gen(function*(){yield* Queue.offer(queue,9);return i<1}));i++){yield* Queue.offer(queue,7)}}).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:"suspend"});
const loopUpdate=()=>Stream.callback<number>(queue=>Effect.gen(function*(){for(let i=0;i<1;(yield* Effect.gen(function*(){yield* Queue.offer(queue,9);return i++}))){yield* Queue.offer(queue,7)}}).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:"suspend"});
const computedAssignment=()=>Stream.callback<number>(queue=>Effect.gen(function*(){const obj:{[key:string]:number|undefined}={};let n=0;({[(yield* Effect.gen(function*(){yield* Queue.offer(queue,9);return "n"}))]:n=7}=obj);yield* Queue.offer(queue,n)}).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:"suspend"});
export function main(){return Effect.gen(function*(){
 const a=yield* Stream.runCollect(new Derived().values())
 const b=yield* Stream.runCollect(caseTest())
 const c=yield* Stream.runCollect(optional(null))
 const d=yield* Stream.runCollect(optional({m(n:number){return n}}))
 const e=yield* Stream.runCollect(loopTest())
 const f=yield* Stream.runCollect(loopUpdate())
 const g=yield* Stream.runCollect(computedAssignment())
 return [a,b,c,d,e,f,g]
})}

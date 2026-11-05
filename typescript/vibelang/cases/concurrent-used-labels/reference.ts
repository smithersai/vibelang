import {Effect} from "effect"
export function reference(){return Effect.gen(function*(){
 let total=0
 yield* Effect.forEach([1,2],x=>Effect.gen(function*(){if(x===1)return;total+=x}),{concurrency:1,discard:true})
 yield* Effect.forEach([1,2,3],x=>Effect.gen(function*(){if(x===1||x===2)return;total+=x}),{concurrency:1,discard:true})
 yield* Effect.forEach([1,2],x=>Effect.gen(function*(){if(x===1)return;total+=7}),{concurrency:1,discard:true})
 return total
})}

import { Effect } from "effect"
export function reference() {
 return Effect.gen(function* () {
  const values: number[] = []
  let n = 0
  yield* Effect.forEach([1, 2], x => Effect.gen(function* () { if(x===1)return; n+=x }), {concurrency:"unbounded",discard:true})
  values.push(n);n=0
  yield* Effect.forEach([1, 2], x => Effect.gen(function* () { for(const y of [1,2]) {if(x===1)return;n+=y} }), {concurrency:1,discard:true})
  values.push(n);n=0
  yield* Effect.forEach([1, 2], x => Effect.gen(function* () {
   yield* Effect.uninterruptibleMask(() => Effect.gen(function* () {if(x===1)return;n+=x}))
  }), {concurrency:2,discard:true})
  values.push(n);n=0
  yield* Effect.forEach([1, 2], x => Effect.gen(function* () {switch(x){case 1:return;default:n+=x;break} }), {concurrency:"unbounded",discard:true})
  values.push(n);n=0
  yield* Effect.forEach([1, 2], x => Effect.gen(function* () {
   inner:for(const y of [1,2]){if(y===1)continue inner;if(x===1)return;n+=y}
  }), {concurrency:"unbounded",discard:true})
  values.push(n)
  const events:string[]=[]
  function* items(){try{yield 1;yield 2}finally{events.push("close")}}
  yield* Effect.forEach([1,2],x=>Effect.gen(function*(){for(const y of items()){events.push(`${x}:${y}`);return}}),{concurrency:1,discard:true})
  return {values,events}
 })
}

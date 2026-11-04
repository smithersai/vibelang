import { Effect, Stream } from "effect"
export function reference() {
 return Effect.gen(function* () {
  const values: number[] = []
  for(let i=0;i<4;i++) {
   let n=0
   yield* Effect.forEach([1,2],x=>Effect.gen(function*(){
    if(x===1)return
    const value=i===3 ? yield* Effect.succeed(7) : 7
    n+=value
   }),{concurrency:1,discard:true})
   values.push(n)
  }
  let n=0
  yield* Effect.forEach([1,2],()=>Effect.gen(function*(){
   for(const y of [1,2]) {if(y===1)continue;n+=7}
  }),{concurrency:1,discard:true})
  values.push(n);n=0
  yield* Effect.forEach([1,2],x=>Effect.gen(function*(){
   const item={skip:false}
   yield* Effect.uninterruptibleMask(()=>Effect.gen(function*(){
    if(x===1){item.skip=true;return}
   }))
   if(item.skip)return
   n+=7
  }),{concurrency:1,discard:true})
  values.push(n);n=0
  yield* Stream.runForEachWhile(Stream.make(1,2),x=>Effect.gen(function*(){
   if(x===1)return true
   n+=7;return true
  }))
  values.push(n)
  return values
 })
}

import {Effect} from "effect"
export function main():Effect.Effect<number[]> {
 return Effect.gen(function*(){
 const out:number[]=[]
 yield* Effect.forEach([1,2,3],n=>Effect.gen(function*(){if(n===2)return;out.push(n)}),{concurrency:1,discard:true})
 yield* Effect.forEach([4,5,6],n=>Effect.gen(function*(){
  if(n===5)return
  for(const x of [0,1,2]){if(x===0)continue;out.push(n*10+x);break}
  switch(n){case 4:out.push(400);break;default:out.push(600)}
 }),{concurrency:1,discard:true})
 return out
 })
}

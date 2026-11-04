import {Effect,Stream} from "effect"
export function main(values: ReadonlyArray<number>) { return Effect.gen(function*(){
 let sum=0
 yield* Effect.forEach(values,item=>Effect.sync(()=>{sum+=item}),{concurrency:"unbounded",discard:true})
 return sum
}) }
function rejected(){
 // @ts-expect-error A Stream is not an Iterable; the Vibe twin owns this as EK1901.
 return Effect.forEach(Stream.make(1,2,3),()=>Effect.succeed(undefined))
}

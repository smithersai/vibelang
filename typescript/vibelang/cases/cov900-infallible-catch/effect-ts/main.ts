// Chapter 900: cov900-infallible-catch — independent Effect reference.
import {Effect} from "effect"
export function main(){return Effect.gen(function*(){
 let calls=0
 const n=yield* Effect.sync(()=>{calls++;return 1})
 const m=yield* Effect.catch(Effect.succeed(2),()=>Effect.sync(()=>{calls+=100;return 0}))
 return [n+m,calls]
})}

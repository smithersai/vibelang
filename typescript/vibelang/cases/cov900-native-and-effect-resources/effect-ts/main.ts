// Chapter 900: cov900-native-and-effect-resources — independent Effect reference.
import {Effect} from "effect"
function native(events:string[]){return {[Symbol.dispose](){events.push("native")}}}
export function main(){return Effect.gen(function*(){
 const events:string[]=[]
 {using resource=native(events)}
 yield* Effect.scoped(Effect.gen(function*(){
  const resource=yield* Effect.acquireRelease(Effect.succeed("effect"),value=>Effect.sync(()=>{events.push(value)}))
  events.push(resource)
 }))
 return events
})}

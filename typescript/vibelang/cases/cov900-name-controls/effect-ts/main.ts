// Chapter 900: cov900-name-controls — independent Effect reference.
import {Effect} from "effect"
export function fork():Effect.Effect<number> {return Effect.gen(function*(){return 2})}
const declaredFork=fork
const o={join():Effect.Effect<number>{return Effect.gen(function*(){return 3})}}
const effect=(x:number)=>x+1
const names={fork:4,join:5}
export function main(){return Effect.gen(function*(){
 return [yield* declaredFork(),yield* o.join(),effect(5),names.fork,names.join]
})}

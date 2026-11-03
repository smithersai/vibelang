// Chapter 900: cov900-plain-generators — independent Effect reference.
import {Effect} from "effect"
function* sequential() {yield 1;return 7}
async function* asynchronous() {yield 2;return 8}
export function main() {return Effect.gen(function*(){
 const a=yield* Effect.try(()=>{const it=sequential();return [it.next().value,it.next().value]})
 const b=yield* Effect.tryPromise(async()=>{const it=asynchronous();return [(await it.next()).value,(await it.next()).value]})
 return [a,b]
})}

import {Effect,Fiber} from "effect"
export function main():Effect.Effect<number[]> {
 return Effect.gen(function*(){
  const child=yield* Effect.forkChild(Effect.succeed(2))
  const out=[(yield* Fiber.join(child))+1]
  const ids=[4,5]
  function load(n:number){return Effect.succeed(n)}
  out.push(...yield* Effect.all([load(1),load(2)],{concurrency:"unbounded"}))
  out.push(...yield* Effect.all(ids.map(load),{concurrency:"unbounded"}))
  yield* Effect.forEach([6,7],n=>Effect.sync(()=>{out.push(n)}),{concurrency:"unbounded",discard:true})
  return out
 })
}

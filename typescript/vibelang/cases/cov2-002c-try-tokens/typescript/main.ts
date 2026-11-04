import {Effect} from "effect"
export function main():Effect.Effect<number[]>{
 return Effect.gen(function*(){
  const a=yield* Effect.all([Effect.succeed(1)],{concurrency:"unbounded"})
  const b=yield* Effect.all([Effect.succeed(2)],{concurrency:"unbounded"})
  return [...a,...b]
 })
}

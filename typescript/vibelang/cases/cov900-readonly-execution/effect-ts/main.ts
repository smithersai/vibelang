// Chapter 900: cov900-readonly-execution — independent Effect reference.
import {Effect} from "effect"
const tuple:readonly [Effect.Effect<number>,Effect.Effect<number>]=[Effect.succeed(1),Effect.succeed(2)]
export function main(){return Effect.gen(function*(){
 const values=yield* Effect.all(tuple,{concurrency:"unbounded"})
 const settled=yield* Effect.all([Effect.exit(tuple[0]),Effect.exit(tuple[1])],{concurrency:"unbounded"})
 return [values,settled.map(e=>e._tag)]
})}

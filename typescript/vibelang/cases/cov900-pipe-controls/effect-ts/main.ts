// Chapter 900: cov900-pipe-controls — independent Effect reference.
import {Effect} from "effect"
export function main(){return Effect.gen(function*(){
 const a=2;const b=a+1;const left=b*2
 const c=7;const captured=()=>Effect.succeed(c)
 const x=yield* Effect.catch(Effect.succeed(5),()=>Effect.succeed(0));const closed=x+1
 const y=yield* Effect.catch(Effect.succeed(5),()=>Effect.succeed(0));const grouped=y+1
 const topic=1
 return [left,yield* captured(),closed,grouped,topic+2]
})}

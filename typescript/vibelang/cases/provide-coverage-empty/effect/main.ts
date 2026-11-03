import {Effect,Layer,Exit} from "effect"
const observed:unknown[]=[]
const Live=Layer.effectDiscard(Effect.acquireRelease(Effect.succeed(undefined),(_,ex)=>Effect.sync(()=>{observed.push(Exit.isSuccess(ex)?ex.value??"undefined":ex._tag)})))
export function main(){return Effect.gen(function*(){yield* Effect.provide(Effect.gen(function*(){}),Live);return [19,observed]})}

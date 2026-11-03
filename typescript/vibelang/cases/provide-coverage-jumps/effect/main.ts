import {Effect,Layer,Context,Exit} from "effect"
class NumberService extends Context.Service<NumberService,{value:number}>()("NumberService") {}
const observed:unknown[]=[]
const Live=Layer.effectDiscard(Effect.acquireRelease(Effect.succeed(undefined),(_,ex)=>Effect.sync(()=>{observed.push(Exit.isSuccess(ex)?ex.value??"undefined":ex._tag)})))
function returned() {return Effect.provide(Effect.gen(function*(){return (yield* NumberService).value}),[Live,Layer.succeed(NumberService,{value:7})])}
function completed() {return Effect.gen(function*(){yield* Effect.provide(Effect.gen(function*(){}),Live);return 12})}
function jumps() {return Effect.gen(function*(){
 const seen:number[]=[]
 for(let i=0;i<5;i++){
  let signal:string="next"
  yield* Effect.provide(Effect.gen(function*(){if(i===1){signal="continue";return}if(i===3){signal="break";return}seen.push(i)}),Live)
  if(signal==="continue")continue
  if(signal==="break")break
 }
 return seen
})}
function bare() {return Effect.provide(Effect.gen(function*(){return}),Live)}
export function main() {return Effect.gen(function*(){const a=yield* returned();const b=yield* completed();const xs=yield* jumps();yield* bare();return [a,b,xs]})}

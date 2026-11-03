import {Effect,Exit,Cause} from "effect"
function make(bad:boolean,events:string[]):Effect.Effect<Effect.Effect<number,"inner">,"outer"> {
 events.push("make")
 return bad ? Effect.fail("outer" as const) : Effect.succeed(Effect.fail("inner" as const))
}
function narrow(bad:boolean,events:string[]):Effect.Effect<number,"outer"> {
 return Effect.gen(function*(){
  return yield* Effect.catch(yield* make(bad,events),e=>{
   const typed:"inner"=e
   events.push(typed)
   return Effect.succeed(e.length)
  })
 })
}
export function main():Effect.Effect<unknown> {
 return Effect.gen(function*(){
  const a:string[]=[],b:string[]=[]
  const first=yield* Effect.exit(narrow(true,a)),second=yield* Effect.exit(narrow(false,b))
  return [Exit.isFailure(first)?Cause.squash(first.cause):"wrong",Exit.isSuccess(second)?second.value:-1,a,b]
 })
}

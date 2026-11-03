import {Effect,Exit,Cause} from "effect"
function start(bad:boolean, events:string[]):Effect.Effect<number,"outer"> {
 events.push("argument")
 return bad ? Effect.fail("outer" as const) : Effect.succeed(3)
}
function build(n:number,events:string[]):Effect.Effect<number,"inner"> {
 events.push("build:"+n)
 return Effect.fail("inner" as const)
}
function narrow(bad:boolean,events:string[]):Effect.Effect<number,"outer"> {
 return Effect.gen(function*(){
  return yield* Effect.catch(build(yield* start(bad,events),events),e=>{
   const typed:"inner"=e
   events.push(typed)
   return Effect.succeed(e.length)
  })
 })
}
export function main():Effect.Effect<unknown> {
 return Effect.gen(function*(){
  const a:string[]=[],b:string[]=[]
  const first=yield* Effect.exit(narrow(true,a))
  const second=yield* Effect.exit(narrow(false,b))
  return [Exit.isFailure(first)?Cause.squash(first.cause):"wrong",Exit.isSuccess(second)?second.value:-1,a,b]
 })
}

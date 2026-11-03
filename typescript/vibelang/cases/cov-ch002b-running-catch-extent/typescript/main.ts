import { Effect, Exit, Cause, Fiber } from "effect"
function parse(bad:boolean,events:string[]):Effect.Effect<number,string>{events.push("parse");return bad?Effect.fail("parse"):Effect.succeed(7)}
function decode(n:number,events:string[]):Effect.Effect<number,string>{events.push("decode");return n===7?Effect.fail("decode"):Effect.succeed(n)}
function narrow(bad:boolean,events:string[]){return Effect.gen(function*(){return yield* Effect.catch(decode(yield* parse(bad,events),events),e=>Effect.sync(()=>{events.push("handler");return e.length}))})}
function wide(events:string[]){return Effect.catch(Effect.gen(function*(){return yield* decode(yield* parse(true,events),events)}),e=>Effect.sync(()=>{events.push("handler");return e.length}))}
function joined(){return Effect.gen(function*(){const f=yield* Effect.forkChild(Effect.succeed(Effect.fail("inner")));return yield* Effect.catch(yield* Fiber.join(f),e=>Effect.succeed(e.length))})}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 const a:string[]=[],b:string[]=[],c:string[]=[]
 const first=yield* Effect.exit(narrow(true,a)),second=yield* Effect.exit(narrow(false,b))
 const wideValue=yield* wide(c)
 const argument=yield* Effect.catch(Effect.succeed(7),()=>Effect.succeed(0))
 const spanned=yield* Effect.withSpan(Effect.gen(function*(){return yield* Effect.catch(Effect.succeed(9),()=>Effect.succeed(0))}),"read")
 return [Exit.isFailure(first)?Cause.squash(first.cause):"wrong",Exit.isSuccess(second)?second.value:0,a,b,wideValue,c,yield* joined(),argument,spanned]
})}

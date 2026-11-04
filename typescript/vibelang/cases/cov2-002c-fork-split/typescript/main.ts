import {Effect,Fiber,Exit,Cause} from "effect"
export function main():Effect.Effect<unknown[],string> {
 return Effect.gen(function*(){
 const events:string[]=[]
 function worker(n:number):Effect.Effect<never,string>{
  events.push("build")
  return Effect.andThen(Effect.sync(()=>{events.push("run")}),Effect.fail("worker "+n))
 }
 function start(id:Effect.Effect<number,string>){
  return Effect.gen(function*(){
   const child=yield* Effect.forkChild(Effect.catch(worker(yield* id),e=>Effect.sync(()=>{events.push("handle");return "recovered "+e})))
   const recovered=yield* Fiber.join(child)
   events.push(recovered)
   return "started"
  })
 }
 const success=yield* start(Effect.succeed(1))
 const good=[success,[...events]]
 events.length=0
 const failure=yield* Effect.exit(start(Effect.fail("no id")))
 return [good,[failure._tag,Exit.isFailure(failure)?Cause.squash(failure.cause):"wrong",[...events]]]
 })
}

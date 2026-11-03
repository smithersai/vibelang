import {Effect,Fiber} from "effect"
function id(events:string[]){return Effect.sync(()=>{events.push("id");return 1})}
function worker(n:number,events:string[]):Effect.Effect<number,string>{events.push("build");return Effect.sync(()=>{events.push("run");return n})}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 const events:string[]=[]
 const child=yield* Effect.forkChild(Effect.catch(worker(yield* id(events),events),e=>Effect.succeed(e.length)))
 events.push("parent")
 return [yield* Fiber.join(child),events]
})}

// Chapter 900: cov900-service-values — independent Effect reference.
import { Context, Effect, Layer } from "effect"
class Store extends Context.Service<Store,{value:number}>()("cov900/Store") {}
const Flags = Context.Reference<{active:boolean}>("cov900/Flags",{defaultValue:()=>({active:false})})
class Users extends Context.Service<Users,{find(id:string):Effect.Effect<string>}>()("cov900/Users") {}
function read():Effect.Effect<number,never,Store> {return Effect.gen(function*(){return (yield* Store).value})}
export function main() {return Effect.gen(function*(){
 const value=yield* Effect.provide(read(),Layer.succeed(Store,{value:7}))
 const id=yield* Effect.provide(Effect.gen(function*(){return yield* (yield* Users).find("x")}),Layer.succeed(Users,{find:(id)=>Effect.succeed(id)}))
 return [value,(yield* Flags).active,id]
})}

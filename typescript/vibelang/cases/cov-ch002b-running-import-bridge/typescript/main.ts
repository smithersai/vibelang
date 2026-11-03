import {Effect,Exit,Cause} from "effect"
import {badSpecifier,badOptions,badCoercion} from "./arguments.js"
type Worker=typeof import("./dep.js")
import {value as staticValue} from "./dep.js"
export function main():Effect.Effect<unknown> {return Effect.gen(function*(){
 const events:string[]=[]
 const loaded:Worker=yield* Effect.orDie(Effect.tryPromise(()=>import("./dep.js")))
 const a=yield* Effect.exit(Effect.tryPromise({try:()=>import(badSpecifier(events)),catch:e=>e}))
 const b=yield* Effect.exit(Effect.tryPromise({try:()=>import("./dep.js",badOptions(events)),catch:e=>e}))
 const c=yield* Effect.exit(Effect.tryPromise({try:()=>import(badCoercion(events)),catch:e=>e}))
 const value=(ex:Exit.Exit<unknown,unknown>)=>Exit.isFailure(ex)?Cause.squash(ex.cause):"wrong"
 return [loaded.value,staticValue,events,value(a),value(b),value(c)]
})}

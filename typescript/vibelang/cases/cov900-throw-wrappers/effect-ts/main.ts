// Chapter 900: cov900-throw-wrappers — independent Effect reference.
import {Cause,Data,Effect,Exit,Schema} from "effect"
import {each,later,User} from "./helpers.js"
class BadJson extends Data.TaggedError("BadJson")<{readonly cause:unknown}>{}
function summary(e:Exit.Exit<unknown,unknown>):unknown {
 if(e._tag==="Success")return e.value
 const reason=e.cause.reasons[0]
 return reason._tag==="Fail"?typeof reason.error==="string"?reason.error:(reason.error as {_tag:string})._tag:reason._tag
}
export function main(){return Effect.gen(function*(){
 const called=yield* Effect.exit(Effect.try({try:()=>each([1],()=>{throw "callback"}),catch:e=>e}))
 const json=yield* Effect.exit(Effect.try({try:()=>JSON.parse("{"),catch:cause=>new BadJson({cause})}))
 const rejected=yield* Effect.exit(Effect.tryPromise(()=>later()))
 const decoder=Schema.decodeUnknownSync(User)
 const invalid=yield* Effect.exit(Effect.try(()=>decoder({name:1})))
 const mapped=yield* Effect.succeed(2).pipe(Effect.map(n=>n*2),Effect.retry({times:1}))
 return [summary(called),summary(json),summary(rejected),summary(invalid),mapped]
})}

import {Effect,Exit} from "effect"
function later() { return new Promise<never>(()=>{throw new Error("executor")}) }
function summary(exit: Exit.Exit<unknown, unknown>): string {
 if(exit._tag === "Success") return "unexpected"
 const reason=exit.cause.reasons[0]
 if(reason._tag !== "Fail") return reason._tag
 const error=reason.error as {_tag:string;cause:Error}
 return error._tag+":"+error.cause.message
}
export function main() { return Effect.gen(function*(){
 const a=yield* Effect.exit(Effect.tryPromise(()=>later()))
 const b=yield* Effect.exit(Effect.tryPromise(()=>new Promise<never>(()=>{throw new Error("thunk")})))
 return [summary(a),summary(b)]
})}

import { Effect } from "effect"
function* numbers(log:string[]){try{yield 1;yield 2}finally{log.push("closed")}}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){const log:string[]=[];const result=yield* Effect.exit(Effect.sync(()=>{const it=numbers(log);it.next();try{throw "t"}finally{it.return(undefined)}}));return [result._tag,result._tag==="Failure"&&result.cause.reasons.map(r=>r._tag),log]})}

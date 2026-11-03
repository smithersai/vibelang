import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const log:string[]=[];const seen:number[]=[]
function* numbers(){try{yield 1;yield 2}finally{log.push("closed")}}
outer:for(let i=0;i<3;i++){for(const a of numbers()){seen.push(a);if(i===0)continue outer;break outer;}}
return [seen,log]
}) }

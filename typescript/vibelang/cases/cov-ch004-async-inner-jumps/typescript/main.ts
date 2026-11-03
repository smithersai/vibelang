import { Effect } from "effect"
async function compute(): Promise<number> { const f=()=>{return 7}; for(let i=0;i<2;i++){if(i===0)continue;break}; return f() }
export function main(): Effect.Effect<unknown> { return Effect.promise(compute) }

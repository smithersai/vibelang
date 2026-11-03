import { Effect } from "effect"
import { items } from "./native.js"
function witness():unknown {const log:string[]=[];const it=items(log,true,true);const errors:unknown[]=[];try{const first=it.next();if(!first.done){const value=first.value;if(typeof value==="object"&&value!==null&&"value" in value)void value.value}}catch(e){errors.push(e)}try{it.return(undefined as never)}catch(e){errors.push(e)}try{if(errors.length>1)throw new AggregateError(errors);if(errors.length===1)throw errors[0];return ["miss",log]}catch(e){return [e instanceof AggregateError?e.errors.map((x:Error)=>x.message):[(e as Error).message],log]}}
export function main():Effect.Effect<unknown> {return Effect.sync(witness)}

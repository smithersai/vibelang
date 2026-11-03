import { Effect } from "effect"
function witness():string[]{const s=2 as unknown as boolean;try{let value:number;if(s===true)value=1;else if(s===false)value=0;else throw new TypeError();return ["matched",String(value)]}catch(e){return [e instanceof TypeError?"TypeError":"other",(e as Error).message]}}
export function main():Effect.Effect<unknown>{return Effect.sync(witness)}

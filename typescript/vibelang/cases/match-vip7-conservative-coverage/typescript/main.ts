import { Effect } from "effect"
function both(x:boolean):number{if(x===true&&x===true)return 1;if(x===false)return 0;return -1}
function negative(x:boolean):number{if(!Object.is(x,false))return 1;if(x===false)return 0;return -1}
export function main():Effect.Effect<readonly number[]>{return Effect.sync(()=>[both(true),both(false),negative(true),negative(false)])}

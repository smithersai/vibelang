import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
let name=""
try{(()=>{const read=()=>value;read();let value:unknown=1})()}catch(e){name=e instanceof ReferenceError?"ReferenceError":"other"}
return name
}) }

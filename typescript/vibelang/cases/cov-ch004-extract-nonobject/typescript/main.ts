import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const result:unknown=true
let name=""
try{if(typeof result!=="object"||result===null)throw new TypeError()}catch(e){name=e instanceof TypeError?"TypeError":"other"}
return name
}) }

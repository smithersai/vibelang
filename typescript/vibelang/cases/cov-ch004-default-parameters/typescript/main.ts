import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
let calls=0
function next(){return ++calls}
function good(a=(()=>{let captured=next();const ok=true;return [ok,captured]})()){return a}
const result=[next(),next()===2?next():0,next()]
return [result,good(),good.length,calls]
}) }

import { Effect } from "effect"
import { holes } from "./native-default-iterator.js"
function f(log:string[]){
  const [x] = holes(log)
  if (x === undefined) return 9
  log.push("after")
  return x
}
function witness0(){const log:string[]=[];return [f(log),log]}
export function main(){return Effect.succeed(witness0())}

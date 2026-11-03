import { Effect } from "effect"
import { numbers } from "./native.js"
function first(log:string[]):number {for(const a of numbers(log))return a;return -1}
function witness():unknown {const log:string[]=[];return [first(log),log]}
export function main():Effect.Effect<unknown> {return Effect.sync(witness)}

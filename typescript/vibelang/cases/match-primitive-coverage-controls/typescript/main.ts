import { Effect } from "effect"
function choose(x:1|2):number { if(typeof x==="number") return x; return 0 }
function narrow(x:unknown):number {
 if(typeof x==="number" || x instanceof Number) return x.valueOf()
 return -1
}
export function main():Effect.Effect<readonly number[],never> {
 return Effect.sync(():readonly number[] => [choose(1),choose(2),narrow(7),narrow("no")])
}

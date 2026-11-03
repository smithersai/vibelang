import { Effect } from "effect"
import { numbers } from "./native.js"
function* subject(log:string[]):Generator<number,unknown,unknown>{for(const a of numbers(log)){yield a;return 0}return 0}
function witness():unknown {const log:string[]=[];const g=subject(log);return [g.next(),g.return(5),log]}
export function main():Effect.Effect<unknown> {return Effect.sync(witness)}

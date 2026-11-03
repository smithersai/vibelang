import { Effect } from "effect"
import { numbers } from "./native.js"
function failed(log:string[]){return Effect.gen(function*(){const iterator=numbers(log);const a=iterator.next();if(!a.done)return yield* Effect.fail("bad");return 0})}
function witness():unknown{const log:string[]=[];return [Effect.runSyncExit(failed(log)),log]}
export function main():Effect.Effect<unknown> {return Effect.sync(witness)}

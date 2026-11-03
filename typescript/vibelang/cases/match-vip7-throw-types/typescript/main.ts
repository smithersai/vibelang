import { Effect } from "effect"
function probe(s:boolean){return Effect.gen(function*(){if(s)return 1 as const;return yield* Effect.fail(new Error("bad"))})}
export function main():Effect.Effect<readonly unknown[]>{const typed:ReturnType<typeof probe> extends Effect.Effect<infer A,any,any>?(A extends 1?true:false):false=true;return Effect.sync(()=>[typed,Effect.runSync(probe(true)),Effect.runSyncExit(probe(false))])}

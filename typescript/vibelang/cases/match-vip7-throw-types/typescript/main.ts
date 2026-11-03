import { Effect } from "effect"
function probe(s:boolean){if(s)return 1 as const;throw new Error("bad")}
export function main():Effect.Effect<readonly unknown[]>{const typed:ReturnType<typeof probe> extends 1?true:false=true;return Effect.sync(()=>[typed,probe(true),Effect.runSyncExit(Effect.sync(()=>probe(false)))])}

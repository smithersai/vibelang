import { Effect } from "effect"
export function main() { return Effect.gen(function* () { const events: string[] = []; const a = yield* Effect.sync(() => { events.push("run"); return 7 }); events.push("after"); return [a,events] }) }

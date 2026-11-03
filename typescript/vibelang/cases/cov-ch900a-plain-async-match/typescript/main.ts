import { Effect } from "effect"
function plain() { return (async () => { return await Promise.resolve(2) })() }
export function main() { return Effect.gen(function* () { return yield* Effect.promise(() => plain()) }) }

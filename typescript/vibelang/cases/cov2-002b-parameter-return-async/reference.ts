import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
async function early(x: number | undefined = undefined) { if (x === undefined) return 7; return 0 }
export function main() { return Effect.promise(() => early()) }

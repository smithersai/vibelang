import { Effect } from "effect"
export const compact = (n: number) => Effect.gen(function* () { return ++n })
export const expanded = (n: number) => Effect.gen(function* () { const result = ++n; return result })
export function declared(n: number) { return Effect.gen(function* () { return ++n }) }
export const expression = function (n: number) { return Effect.gen(function* () { return ++n }) }
export function declaredProgram(n: number) { return Effect.gen(function* () { return yield* Effect.succeed(++n) }) }
export const closure = (n: number) => Effect.gen(function* () { return () => ++n })

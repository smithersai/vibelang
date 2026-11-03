import { Effect } from "effect"
export const compact = (n: number) => Effect.gen(function* () { return n = n + 1 })
export const expanded = (n: number) => Effect.gen(function* () {
  const result = n = n + 1
  return result
})
export function declared(n: number) { return Effect.gen(function* () { return n = n + 1 }) }
export const expression = function (n: number) { return Effect.gen(function* () { return n = n + 1 }) }
export function declaredProgram(n: number) { return Effect.gen(function* () { return yield* Effect.succeed(n = n + 1) }) }

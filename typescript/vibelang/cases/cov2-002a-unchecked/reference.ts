import { inputs } from "./inputs.js"
// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
function unchecked(value: any) {
 return Effect.gen(function* () { return yield* value })
}
export function main() { return Effect.gen(function* () {
 const observations: unknown[] = []
 for (const value of inputs()) {
  const result = yield* Effect.exit(unchecked(value))
  observations.push(result._tag === "Success" ? ["Success", result.value] : result.cause.reasons.map(r => r._tag === "Die" ? ["Die", r.defect instanceof TypeError] : [r._tag]))
 }
 return observations
}) }

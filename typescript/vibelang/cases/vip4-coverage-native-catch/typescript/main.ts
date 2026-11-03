import { Effect } from "effect"
import { getter, rejected, sentinel } from "./foreign.js"
function catches() {
  let finalized = 0
  let same = false
  try { getter().value } catch (e) { same = e === sentinel } finally { finalized++ }
  let nullCaught = false
  try { const value: { n: number } = undefined as any; void value.n } catch (e) { nullCaught = e instanceof TypeError }
  return [same, finalized, nullCaught]
}
async function catchesAsync() {
  try { await rejected(); return false } catch (e) { return e === sentinel }
}
export function main(): Effect.Effect<readonly unknown[],unknown> { return Effect.gen(function* () {
  const died = yield* Effect.exit(Effect.gen(function* () { return getter().value }))
  return [catches(), yield* Effect.tryPromise(catchesAsync), died._tag === "Failure" && died.cause.reasons[0]?._tag === "Die" && died.cause.reasons[0].defect === sentinel]
}) }

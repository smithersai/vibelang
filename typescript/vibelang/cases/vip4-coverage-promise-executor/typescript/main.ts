import { Effect } from "effect"
import { executor } from "./foreign.js"
function build() { return new Promise<never>(executor) }
async function observed() {
  let synchronous = false
  let same = false
  let held: Promise<never> | undefined
  try { held = build() } catch { synchronous = true }
  try { await held } catch (error) { same = error === "executor" }
  return [synchronous,same]
}
export function main(): Effect.Effect<readonly unknown[],unknown> { return Effect.gen(function* () {
  return yield* Effect.tryPromise(observed)
}) }

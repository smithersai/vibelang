import { Effect } from "effect"
export const state = { factories: 0, runs: 0 }
export function make() {
  state.factories++
  return Effect.sync(() => { state.runs++; return 7 })
}
export function invoke(callback: () => void) { callback() }

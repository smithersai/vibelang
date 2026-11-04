import { Effect } from "effect"
import { iterator } from "./native.js"
export function main(): Effect.Effect<unknown> {
  return Effect.sync(() => {
    const log: string[] = []
    let error: unknown
    try { for (const value of iterator(log)) { break } } catch (e) { error = e }
    return [String(error), log]
  })
}

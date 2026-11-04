// expect-result: 7
import { Effect } from "effect"
import { parse } from "./foreign.js"
export function main() {
 return Effect.catch(Effect.fail(new Error("input")), () => Effect.succeed((() => {
  try { return parse("bad") } catch { return 7 }
 })()))
}

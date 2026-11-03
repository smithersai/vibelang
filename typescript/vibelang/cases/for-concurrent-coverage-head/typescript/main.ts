import { Effect } from "effect"
import { operand } from "./helper.js"
export function main(): Effect.Effect<string[]> {
 return Effect.gen(function* () {
  const trace: string[] = []
  const x = 99
  function limit() { trace.push("limit"); return 1 }
  const concurrency = limit()
  // The RHS's separate lexical binding is never initialized by an item.
  const task = (() => {
    trace.push("operand")
    const source = operand(() => x, trace)
    return Effect.forEach(source, item => Effect.sync(() => { trace.push("body:" + item) }), {concurrency,discard:true})
    const x = 0
  })()
  const result = yield* Effect.exit(task)
  trace.push(result._tag)
  return trace
 })
}

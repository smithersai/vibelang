import { Effect } from "effect"
import { iterator } from "./main.vibe.iterators.js"

// FinishMatch closes both unfinished iterators in insertion order, collecting
// the pending throw and then each closing error in one AggregateError; in
// Effect code that implicit throw is a defect.
function finish(pending: unknown[], log: string[]): unknown[] {
  const inner = iterator(log, "inner", 1), outer = iterator(log, "outer", inner)
  const its = [outer, inner].map((i) => i[Symbol.iterator]())
  for (const it of its) it.next()
  const errors = [...pending]
  for (const it of its) try { it.return?.() } catch (e) { errors.push(e) }
  return new AggregateError(errors).errors.map((e) => e instanceof TypeError ? "TypeError" : e)
}

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
  const thrown: string[] = [], replaced: string[] = []
  const pending = finish([new TypeError("no match")], thrown)
  const closing = finish([], replaced)
  return [pending, thrown, closing, replaced]
}) }

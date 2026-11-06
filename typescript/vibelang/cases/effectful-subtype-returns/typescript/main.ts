import { Effect } from "effect"
import { exit, config, missing, later, broken, events } from "./lib.js"
function direct() {
  return Effect.gen(function* () { const value = broken(); return 0 })
}
function plainProgram(n = 7) { return later(n) }
export function main() {
  return Effect.gen(function* () {
    const n = yield* exit(5)
    const c = yield* config("cfg")
    const failure = missing("a")
    const program = later(2)
    const m = yield* program
    const p = yield* plainProgram()
    const outcome = yield* Effect.exit(direct())
    const reasons = outcome._tag === "Failure" ? outcome.cause.reasons.map((r) => r._tag) : []
    return [n, c, failure._tag, failure.id, m, p, reasons, events]
  })
}

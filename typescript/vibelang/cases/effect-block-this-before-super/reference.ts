import { Effect, Exit } from "effect"

// VIP-1 Bindings: native lexical closures defer receiver reads until run.
// Compiled separately with stock TypeScript 5.9.3 against Effect 4.1.0.
function shape(outcome: Exit.Exit<unknown, unknown>): string {
  if (Exit.isSuccess(outcome)) {
    const value = outcome.value
    return "Success(" + (typeof value === "object" && value !== null ? "instance" : JSON.stringify(value)) + ")"
  }
  return outcome.cause.reasons.map(reason => reason._tag === "Die" ? "Die(" + (reason.defect instanceof ReferenceError ? "ReferenceError" : String(reason.defect)) + ")" : reason._tag).join("+")
}
let keyCalls = 0
function key(): "value" { keyCalls++; return "value" }
class Base { static value = 7; value = 7 }
class After extends Base {
  p: Effect.Effect<unknown>
  constructor() {
    const p = Effect.sync(() => this)
    super()
    this.p = p
  }
}
class Before extends Base {
  constructor(run: (e: Effect.Effect<unknown>) => string, out: string[], flag: boolean) {
    out.push(run(Effect.sync(() => this)))
    out.push(run(Effect.sync(() => { if (flag) return this; return 7 })))
    out.push(run(Effect.sync(() => super[key()])))
    super()
  }
}
class Static extends Base {
  static program: Effect.Effect<unknown>
  static { this.program = Effect.sync(() => super.value) }
}
const runner = (e: Effect.Effect<unknown>): string => shape(Effect.runSyncExit(e))
const before: string[] = []
new Before(runner, before, false)
console.log(JSON.stringify({ after: runner(new After().p), before, keyCalls, static: runner(Static.program) }))

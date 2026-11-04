// Native TypeScript witness retained from before 66e1ff463707.
// VIP-4: written foreign contracts; this is not a VibeLang source-tag example.
// Callable-contract reference witnesses
import { Effect, Exit } from "effect"
function choose(mode: true): Effect.Effect<number>;
function choose(mode: false): number;
function choose(mode: boolean): Effect.Effect<number> | number { throw "boom" }
function later(f: () => number) { return () => f() }
const delayed = later(() => { throw "callback" })
const hidden = Effect.runSyncExit(Effect.sync(() => choose(true)))
const unwrapped = Effect.runSyncExit(Effect.gen(function* () { return delayed() }))
const wrapped = Effect.runSyncExit(Effect.gen(function* () {
  return yield* Effect.try({ try: () => delayed(), catch: (e) => e })
}))
function reason(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) return ["Success", exit.value]
  const r = exit.cause.reasons[0]
  return r._tag === "Die" ? ["Die", r.defect] : r._tag === "Fail" ? ["Fail", r.error] : ["Interrupt"]
}
console.log(JSON.stringify([reason(hidden), reason(unwrapped), reason(wrapped)]))

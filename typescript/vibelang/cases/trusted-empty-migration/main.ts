// expect-result: {"success":6,"defect":-2,"typed":false,"repeat":8,"local":10,"counts":{"captureReads":2,"applyReads":4}}
import { Cause, Effect, Exit } from "effect"
import { local, value } from "./lib.vibe"
import { counts } from "./plain.ts"
export function main() {
  return Effect.gen(function* () {
    const program = value(3)
    const success = yield* program
    const failed = yield* Effect.exit(value(-2))
    return { success, defect: Exit.isFailure(failed) ? Cause.squash(failed.cause) : null, typed: Exit.isFailure(failed) && Cause.hasFails(failed.cause), repeat: yield* value(4), local: yield* local(9, 5), counts: counts() }
  })
}

import { Effect, Exit } from "effect"
import { holes } from "./native.js"
function direct(log: string[]) {
  return Effect.gen(function* () {
    const [x = yield* Effect.fail("bad")] = holes(log)
    return x
  })
}
export function witness() {
  const log: string[] = []
  return [Exit.isFailure(Effect.runSyncExit(direct(log))), log]
}

export function loopWitness() {
  const log: string[] = []
  const program = Effect.gen(function* () {
    for (const outer of [0]) {
      const [x = yield* Effect.fail("bad")] = holes(log)
      return x
    }
  })
  return [Exit.isFailure(Effect.runSyncExit(program)), log]
}

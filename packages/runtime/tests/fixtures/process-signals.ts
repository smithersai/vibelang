// A program under NodeRuntime.runMain that prints READY, then waits. Its cleanup finalizer reads which signal ended it
// and exits as the original script did: 130 for SIGINT, 143 for SIGTERM. Run with node or bun; the test sends the signal.
import { NodeRuntime } from "@effect/platform-node"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Runtime from "effect/Runtime"
import { Process } from "vibelang-runtime/experimental"
import { ExperimentalNodeProcess } from "vibelang-runtime/experimental/platform-node"

class SignalExit extends Error {
  readonly [Runtime.errorExitCode]: number
  constructor(code: number) {
    super(`ended by a signal, exit ${code}`)
    this[Runtime.errorExitCode] = code
  }
}

const exitCodes = { SIGINT: 130, SIGTERM: 143 } as const

const program = Effect.scoped(Effect.gen(function*() {
  const process = yield* Process.Process
  const received = yield* process.observeSignals(["SIGINT", "SIGTERM"])
  yield* Effect.addFinalizer(() =>
    Effect.gen(function*() {
      // Read first, synchronously: runMain's own listener interrupts the program, and its finalizers can run before
      // any later listener does.
      const signal = yield* received
      if (Option.isSome(signal) && signal.value !== "SIGINT") {
        return yield* Effect.die(new SignalExit(exitCodes[signal.value as keyof typeof exitCodes] ?? 1))
      }
      yield* Effect.promise(() => Promise.allSettled([]))
    })
  )
  yield* Effect.sync(() => globalThis.process.stdout.write("READY\n"))
  return yield* Effect.never
}))

NodeRuntime.runMain(Effect.provide(program, ExperimentalNodeProcess.layer), { disableErrorReporting: true })

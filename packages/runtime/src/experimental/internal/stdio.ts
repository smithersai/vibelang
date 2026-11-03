import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as EffectStdio from "effect/Stdio"
import * as Stdio from "../Stdio.js"

interface Input {
  readonly readableEnded: boolean
  readonly destroyed: boolean
  readonly on: (event: "end" | "close", listener: () => void) => unknown
  readonly off: (event: "end" | "close", listener: () => void) => unknown
}

// A fresh native handle is read only when the waiting Effect executes.
const input = (): Input => {
  const host = globalThis as { readonly process?: { readonly stdin?: Input } }
  const stdin = host.process?.stdin
  if (stdin === undefined) throw new Error("Experimental.Stdio requires Node or Bun stdin")
  return stdin
}

const awaitInputClosed: Effect.Effect<void> = Effect.scoped(Effect.gen(function*() {
  const stdin = yield* Effect.sync(input)
  if (stdin.readableEnded || stdin.destroyed) return
  let listener: () => void = () => {}
  const attempted: Array<"end" | "close"> = []
  // Register cleanup before native setup: callback cleanup alone is skipped on
  // synchronous completion, and on() may attach a listener before throwing.
  yield* Effect.acquireRelease(
    Effect.void,
    () => Effect.sync(() => {
      for (const event of attempted) stdin.off(event, listener)
    })
  )
  yield* Effect.callback<void>((resume) => {
    let completed = false
    listener = () => {
      if (!completed) {
        completed = true
        resume(Effect.void)
      }
    }
    for (const event of ["end", "close"] as const) {
      attempted.push(event)
      stdin.on(event, listener)
    }
    // Closure can race between the initial flags and the listener registration.
    if (stdin.readableEnded || stdin.destroyed) listener()
  })
}))

/** Extends the Effect Stdio already in context; standard members are reused. */
export const layer: Layer.Layer<Stdio.Stdio, never, EffectStdio.Stdio> = Layer.effect(
  Stdio.Stdio,
  Effect.map(Effect.service(EffectStdio.Stdio), (stdio) => Stdio.make(stdio, { awaitInputClosed }))
)

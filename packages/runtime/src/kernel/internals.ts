// Structural access to Effect 4.1.0 fiber internals.
//
// The kernel needs three things the public Fiber interface does not expose:
// the continuation stack (`_stack`), the interruptibility flag, and the
// pending interruption cause. `effect/internal/*` is not importable
// (package.json maps it to null), so this module reaches them structurally
// through `Effect.withFiber` and the string-keyed primitive protocol
// (internal/core.ts:31-61). Every access is pinned to the exact version.
import type { Cause, Context } from "effect"
import "../version.js"
export { PINNED_EFFECT_VERSION } from "../version.js"

// Frame protocol keys (internal/core.ts:46-58).
export const contA = "~effect/Effect/successCont"
export const contE = "~effect/Effect/failureCont"
export const contAll = "~effect/Effect/ensureCont"
export const identifier = "~effect/Effect/identifier"
// The run loop calls a primitive's evaluate (internal/core.ts:41, internal/effect.ts:625).
export const evaluate = "~effect/Effect/evaluate"
// Every Exit carries it (internal/core.ts:22); the public modules export no constant for it.
export const ExitTypeId = "~effect/Exit"

// The subset of FiberImpl (internal/effect.ts:487-743) the kernel touches.
export interface FiberInternals {
  readonly id: number
  readonly _stack: Array<any>
  interruptible: boolean
  _interruptedCause: Cause.Cause<never> | undefined
  // Set by interruptUnsafe while the fiber runs interruptibly; the run loop
  // consumes it without re-checking interruptibility (internal/effect.ts:636).
  _deferredInterrupt: boolean
  readonly context: Context.Context<never>
  setContext(context: Context.Context<never>): void
}

export const asInternals = (fiber: unknown): FiberInternals => {
  const f = fiber as FiberInternals
  if (!Array.isArray(f._stack) || typeof f.interruptible !== "boolean" || typeof f.setContext !== "function") {
    throw new Error("Unexpected FiberImpl shape: the kernel prototype only supports effect@4.1.0")
  }
  return f
}

// A frame that only restores interruptibility, mirroring `setInterruptible`
// (internal/effect.ts:4570-4578). It has no identifier, so the interruption
// skip loop in exitFailCause (internal/core.ts:600-631) does not count it as
// a recovery handler.
export const restoreInterruptible = (value: boolean) => ({
  [contAll](fiber: FiberInternals) {
    fiber.interruptible = value
    if (value && fiber._interruptedCause) {
      const cause = fiber._interruptedCause
      return () => failCauseNow(cause)
    }
    return undefined
  }
})

// Set by kernel.ts to avoid a circular import.
let failCauseNow: (cause: Cause.Cause<never>) => unknown = () => {
  throw new Error("kernel not initialized")
}
export const setFailCause = (f: (cause: Cause.Cause<never>) => unknown) => {
  failCauseNow = f
}

// Debug view of a frame: the op name for Effect primitives, or the kernel tag.
export const frameName = (frame: any): string => {
  if (frame && typeof frame.esFrame === "string") return frame.esFrame
  const id = frame?.[identifier]
  if (typeof id === "string") return id
  if (frame && contAll in frame && !(contA in frame) && !(contE in frame)) return "RestoreFlag"
  return "Frame"
}

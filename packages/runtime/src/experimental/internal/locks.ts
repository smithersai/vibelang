// The Locks service over the host's `navigator.locks`: browsers share it across
// the tabs and workers of one origin, Node.js across the threads of one process.
import * as Layer from "effect/Layer"
import * as Locks from "../Locks.js"

/** Provides `Locks` over `navigator.locks`; a host without one is a defect when the layer is built. */
export const layer: Layer.Layer<Locks.Locks> = Layer.sync(Locks.Locks, () => {
  const locks = (globalThis as { readonly navigator?: { readonly locks?: Locks.LockManagerLike } }).navigator?.locks
  if (locks === undefined) {
    throw new Error(
      "The Locks layer needs navigator.locks: a browser page or worker in a secure context (https or localhost), or Node.js 24.5 or later"
    )
  }
  return Locks.make(locks)
})

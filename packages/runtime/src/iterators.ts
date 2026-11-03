import { Effect } from "effect"

// Legacy compiler ABI, retained for already-emitted frames. Current compilers
// preserve native generator abandonment (VIP-31) instead of resuming a failed
// frame to run IteratorClose or FinishMatch.

/** @internal Compiler ABI: give Effect ownership of a generator's live native iterators. */
export const $iteratorFrame = <F extends (...args: any[]) => Generator<Effect.Effect<any, any, any>, any, any>>(
  body: F
): F => {
  const wrapped = function(this: unknown, ...args: Parameters<F>) {
    const iterator = Reflect.apply(body, this, args)
    return (function*() {
      return yield* Effect.onExit(Effect.gen(() => iterator), () => Effect.sync(() => unwind(iterator)))
    })()
  }
  Object.defineProperty(wrapped, "length", { value: body.length, configurable: true })
  Object.defineProperty(wrapped, "name", { value: body.name, configurable: true })
  return wrapped as F
}

// A finished generator ignores return(). Source catch and finally are Effect
// regions, never JavaScript try statements (chapter 26), so nothing in the
// generator intercepts the return completion to yield again; a frame that
// does is a defect, since its cleanup cannot run here.
const unwind = (iterator: Generator<unknown, unknown, unknown>) => {
  if (!iterator.return(undefined).done) {
    throw new Error("a generator yielded while its iterator frame was unwound: a JavaScript finally block ran an Effect")
  }
}

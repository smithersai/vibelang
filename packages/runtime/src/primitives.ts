import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

// The primitives of a .vibe file that have their own syntax (D176-D180):
// `catch (cause: Cause)` (retired by D217; it still compiles), `throw cause`, `finally (exit)`, and the
// interruption blocks. The parser writes the markers below for the checker;
// the lowering replaces them with the helpers.

/**
 * `catch (cause: Cause)` (D176) catches every reason a failure holds,
 * expected failures, defects, and interrupts, delegating directly to public
 * Effect.catchCause (VIP-35 handlers were denied; core catch does not depend on
 * continuation kernel internals).
 */
export const $catchCause = <A, E, R, B, E2, R2>(
  self: Effect.Effect<A, E, R>,
  handler: (cause: Cause.Cause<E>) => Effect.Effect<B, E2, R2>
): Effect.Effect<A | B, E2, R | R2> =>
  Effect.catchCause(self, handler)

/** What `$failureOf` returns when a cause holds no expected failure. */
export const $noFailure: unique symbol = Symbol.for("vibelang/noFailure")

/**
 * The first expected failure a cause holds, which the typed and untyped
 * clauses before a Cause clause test, or $noFailure. A cause with a defect
 * has none to recover, as in Effect 4.1.1's typed recovery (D305), so only
 * the Cause clause sees it.
 */
export const $failureOf = <E>(cause: Cause.Cause<E>): E | typeof $noFailure => {
  if (cause.reasons.some(Cause.isDieReason)) return $noFailure
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) return reason.error
  }
  return $noFailure
}

/**
 * The marker `finally (exit)` binds (D178). The checker types it as the Exit
 * of the try statement; the lowering removes it, so it never runs.
 */
export declare function $exit<E = unknown>(): Exit.Exit<void, E>

/**
 * `finally (exit) { ... }` (D178): runs the block on every exit, without
 * interruption, with the Exit. A success carries no value: the try block's
 * statements have none.
 */
export const $finallyExit = <A, E, R, X, E2, R2>(
  self: Effect.Effect<A, E, R>,
  finalizer: (exit: Exit.Exit<void, E>) => Effect.Effect<X, E2, R2>
): Effect.Effect<A, E | E2, R | R2> =>
  Effect.onExit(self, (exit) => Effect.asVoid(finalizer(Exit.isSuccess(exit) ? Exit.void : exit as Exit.Exit<never, E>)))

type Restore = <A, E, R>(program: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

/** The restore of the innermost uninterruptible region a fiber runs in. */
const CurrentRestore = Context.Reference<Restore | undefined>("vibelang/CurrentRestore", {
  defaultValue: () => undefined
})

/**
 * `uninterruptible { ... }` or `uninterruptible(program)` (D180):
 * Effect.uninterruptibleMask. A `restore` inside it brings back the
 * interruptibility the fiber had when the region began.
 */
export const uninterruptible = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.uninterruptibleMask((restore) => Effect.provideService(program, CurrentRestore, restore))

/**
 * `restore { ... }` or `restore(program)` (D180): runs program with the
 * interruptibility the innermost enclosing uninterruptible region began
 * with. Outside one it runs program as it is (EK2111 reports the block form).
 */
export const restore = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => {
    const current = fiber.getRef(CurrentRestore)
    return current === undefined ? program : current(program)
  })

/** `interruptible { ... }` or `interruptible(program)` (D180): Effect.interruptible. */
export const interruptible = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.interruptible(program)

/**
 * The markers the parser writes as the first statement of an
 * uninterruptible, restore, or interruptible block, for the checker; the
 * lowering removes them.
 */
export declare function $uninterruptibleBlock(): void
export declare function $restoreBlock(): void
export declare function $interruptibleBlock(): void

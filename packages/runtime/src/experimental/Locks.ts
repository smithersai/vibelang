/**
 * Exclusive Web Locks as an Effect service.
 *
 * A lock is held by one context at a time: a browser tab, a worker, or, under
 * Node.js, a thread. A context waits for the lock with {@link Locks.hold},
 * holds it until the scope closes, and loses it when the context ends, so a
 * closed or crashed tab hands the lock to the next waiter. A context can also
 * take a lock at once with `steal`; the context that held it learns so from
 * {@link Held.lost}. {@link Locks.tryHold} takes a lock only when it is free.
 *
 * Effect 4.1.0 has no lock service across contexts. This module ports the
 * `WebLock` service Smithers runs its browser engine on, in Effect's style,
 * until Effect ships its own.
 *
 * Layers: `ExperimentalBrowserLocks.layer` from `vibelang-runtime/experimental/platform-browser`
 * (also in its `ExperimentalBrowserServices.layer`) over `navigator.locks`, across the
 * tabs and workers of one origin;
 * `ExperimentalNodeLocks.layer` from `vibelang-runtime/experimental/platform-node` over
 * Node.js's `navigator.locks`, across the threads of one process only, never
 * other processes. Bun has no Web Locks, so it has no layer.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import type * as Scope from "effect/Scope"

/**
 * @category type ids
 * @since 0.0.11
 */
export type TypeId = "~vibelang/experimental/Locks"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/Locks"

/**
 * The slice of the Web Locks `LockManager` this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface LockManagerLike {
  readonly request: (
    name: string,
    options: { readonly signal: AbortSignal } | { readonly steal: true } | { readonly ifAvailable: true },
    callback: (lock: unknown) => Promise<void>
  ) => Promise<unknown>
  readonly query: () => Promise<{
    readonly held?: ReadonlyArray<LockInfoLike> | undefined
    readonly pending?: ReadonlyArray<LockInfoLike> | undefined
  }>
}

/**
 * A lock as `LockManager.query` describes it, before {@link Locks.query}
 * fills in what it leaves out.
 *
 * @category models
 * @since 0.0.11
 */
export interface LockInfoLike {
  readonly name?: string | undefined
  readonly mode?: "exclusive" | "shared" | undefined
  readonly clientId?: string | undefined
}

/**
 * A held or requested lock.
 *
 * @category models
 * @since 0.0.11
 */
export interface LockInfo {
  readonly name: string
  readonly mode: "exclusive" | "shared"
  /** The context that holds or requested it. */
  readonly clientId: string
}

/**
 * The locks held and requested now, across every context that shares the
 * lock manager.
 *
 * @category models
 * @since 0.0.11
 */
export interface LockSnapshot {
  readonly held: ReadonlyArray<LockInfo>
  readonly pending: ReadonlyArray<LockInfo>
}

/**
 * How {@link Locks.hold} takes the lock.
 *
 * @category options
 * @since 0.0.11
 */
export interface HoldOptions {
  /**
   * Takes the lock at once, from whichever context holds it, instead of
   * waiting for it. The holder's {@link Held.lost} completes. A steal cannot
   * be withdrawn: interrupting it still takes the lock from its holder, and
   * then gives it back.
   */
  readonly steal?: boolean | undefined
}

/**
 * A lock this context holds.
 *
 * @category models
 * @since 0.0.11
 */
export interface Held {
  /**
   * Completes when another context steals the lock. It never completes
   * otherwise: the lock is this context's until the scope closes.
   */
  readonly lost: Effect.Effect<void>
}

/**
 * Exclusive locks shared by the contexts of one origin or process.
 *
 * @category models
 * @since 0.0.11
 */
export interface Locks {
  readonly [TypeId]: TypeId
  /**
   * Waits until this context holds the exclusive lock `name`, then holds it
   * until the scope closes, or takes it at once with `steal`. Interrupting
   * the wait withdraws the request. Fails with a `PlatformError` when the
   * lock manager refuses the request: a `BadArgument` for a name that starts
   * with `-`.
   */
  readonly hold: (name: string, options?: HoldOptions) => Effect.Effect<Held, PlatformError.PlatformError, Scope.Scope>
  /**
   * Takes the exclusive lock `name` only when no context holds it or waits
   * for it, and holds it until the scope closes; none otherwise, at once.
   * Fails as {@link Locks.hold} does.
   */
  readonly tryHold: (name: string) => Effect.Effect<Option.Option<Held>, PlatformError.PlatformError, Scope.Scope>
  /** The locks held and requested now. */
  readonly query: Effect.Effect<LockSnapshot, PlatformError.PlatformError>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const Locks: Context.Service<Locks, Locks> = /* @__PURE__ */ Context.Service<Locks>(
  "vibelang/experimental/Locks"
)

// The lock manager's refusal, a DOMException, as a PlatformError.
const failure = (method: "hold" | "tryHold" | "query", cause: unknown): PlatformError.PlatformError => {
  const name = typeof cause === "object" && cause !== null ? (cause as { readonly name?: unknown }).name : undefined
  const description = cause instanceof Error ? cause.message : String(cause)
  // A name that starts with "-", or options the manager does not accept together.
  if (name === "NotSupportedError") return PlatformError.badArgument({ module: "Locks", method, description, cause })
  return PlatformError.systemError({
    // An opaque origin has no lock manager; a document that is no longer active cannot use it.
    _tag: name === "SecurityError" ? "PermissionDenied" : name === "InvalidStateError" ? "BadResource" : "Unknown",
    module: "Locks",
    method,
    description,
    cause
  })
}

const info = (lock: LockInfoLike): LockInfo => ({
  name: lock.name ?? "",
  mode: lock.mode ?? "exclusive",
  clientId: lock.clientId ?? ""
})

/**
 * Builds the service over a lock manager: `navigator.locks`, or a fake in a
 * test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (locks: LockManagerLike): Locks => {
  // Asks for the lock: a wait (`signal`), a steal or an `ifAvailable` request, the last two granted or refused at
  // once. Held, the lock is released when the scope closes; none when an `ifAvailable` request found it taken.
  const request = (name: string, how: "wait" | "steal" | "ifAvailable", method: "hold" | "tryHold") =>
    Effect.gen(function*() {
      const lost = yield* Deferred.make<void>()
      const release = yield* Effect.acquireRelease(
        // Interrupting the wait aborts `signal`, which withdraws the request.
        Effect.callback<(() => void) | undefined, PlatformError.PlatformError>((resume, signal) => {
          let granted = false
          const options = how === "steal" ? { steal: true as const } : how === "ifAvailable"
            ? { ifAvailable: true as const }
            : { signal }
          locks.request(name, options, (lock) => {
            // Taken by another context: an `ifAvailable` request gets no lock.
            if (lock === null) {
              resume(Effect.succeed(undefined))
              return Promise.resolve()
            }
            // Granted in the moment the wait was interrupted: give it back.
            if (signal.aborted) return Promise.resolve()
            granted = true
            return new Promise<void>((release) => resume(Effect.succeed(release)))
          }).catch((cause: unknown) => {
            // A held lock's request rejects when another context steals it.
            if (granted) Deferred.doneUnsafe(lost, Exit.void)
            // A withdrawn request rejects after the wait was interrupted, and
            // nothing is listening for it any more.
            else if (!signal.aborted) resume(Effect.fail(failure(method, cause)))
          })
        }).pipe(Effect.interruptible),
        (release) => Effect.sync(() => release?.())
      )
      return release === undefined ? Option.none<Held>() : Option.some<Held>({ lost: Deferred.await(lost) })
    })
  return {
    [TypeId]: TypeId,
    // A wait or a steal always ends holding the lock.
    hold: (name, options) =>
      Effect.map(request(name, options?.steal === true ? "steal" : "wait", "hold"), Option.getOrThrow),
    tryHold: (name) => request(name, "ifAvailable", "tryHold"),
    query: Effect.tryPromise({
      try: () => locks.query(),
      catch: (cause) => failure("query", cause)
    }).pipe(Effect.map((snapshot) => ({
      held: (snapshot.held ?? []).map(info),
      pending: (snapshot.pending ?? []).map(info)
    })))
  }
}

/**
 * Provides locks that never contend, for tests: every request is granted at
 * once, even for a lock already held, a held lock is never lost, and `query`
 * answers no locks. Pass the members a test needs:
 * `layerTest({ tryHold: () => Effect.succeedNone })`.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<Locks, TypeId>> = {}): Layer.Layer<Locks> =>
  Layer.succeed(Locks, {
    [TypeId]: TypeId,
    hold: () => Effect.succeed({ lost: Effect.never }),
    tryHold: () => Effect.succeed(Option.some({ lost: Effect.never })),
    query: Effect.succeed({ held: [], pending: [] }),
    ...impl
  })

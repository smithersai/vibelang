import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"

/**
 * What acquisitions recorded (D401): for each Scope, the values whose release
 * an acquisition registered in it. `using` adds no release for a recorded
 * value. Weak on both sides, so a record lives no longer than its Scope and
 * its value.
 */
const recorded = new WeakMap<Scope.Scope, WeakSet<object>>()

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function"

/** Records that the release of `value` is registered in `scope`. */
const record = (scope: Scope.Scope, value: unknown): void => {
  if (!isObject(value)) return
  let values = recorded.get(scope)
  if (values === undefined) recorded.set(scope, values = new WeakSet())
  values.add(value)
}

/** Whether an acquisition recorded that it registered the release of `value` in `scope`. */
export const isRecorded = (scope: Scope.Scope, value: unknown): boolean =>
  isObject(value) && recorded.get(scope)?.has(value) === true

/**
 * `Effect.acquireRelease`, as `vibelang-runtime` gives it: Effect's
 * arguments, and what Effect's does, its interruptibility included, and it
 * records the value whose release it registered, so `using` adds no second
 * release (D401, D481). The acquire step is masked unless `{ interruptible:
 * true }`; the release is registered in the Scope the acquisition runs with,
 * and recorded, in the same uninterruptible step that produces the value. A
 * `.vibe` reference to Effect's `acquireRelease` denotes this one.
 */
export const acquireRelease = <A, E, R, R2>(
  acquire: Effect.Effect<A, E, R>,
  release: (a: A, exit: Exit.Exit<unknown, unknown>) => Effect.Effect<unknown, never, R2>,
  options?: { readonly interruptible?: boolean }
): Effect.Effect<A, E, R | R2 | Scope.Scope> =>
  Effect.contextWith((context: Context.Context<R2>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(Effect.scope, (scope) =>
        Effect.tap(options?.interruptible ? restore(acquire) : acquire, (a) => {
          record(scope, a)
          return Scope.addFinalizerExit(scope, (exit) => Effect.provideContext(release(a, exit), context))
        })
      )
    )
  )

/**
 * `Effect.acquireDisposable`, as `vibelang-runtime` gives it (D401): a
 * masked acquisition of a Disposable or an AsyncDisposable whose release
 * calls `[Symbol.asyncDispose]()` when the value has it, else
 * `[Symbol.dispose]()`, as Effect's does, and which records the value
 * (D401). A `.vibe` reference to Effect's `acquireDisposable` denotes this
 * one.
 */
export const acquireDisposable = <A extends AsyncDisposable | Disposable, E, R>(
  acquire: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | Scope.Scope> =>
  acquireRelease(acquire, (resource) =>
    Symbol.asyncDispose in resource
      ? Effect.promise(() => (resource as AsyncDisposable)[Symbol.asyncDispose]())
      : Effect.sync(() => (resource as Disposable)[Symbol.dispose]()))

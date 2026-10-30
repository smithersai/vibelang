import { Cause, Effect, Exit, Scope } from "effect"
import * as K from "./kernel/kernel.js"
import { $direct } from "./fastcalls.js"
import { isRecorded } from "./resources.js"

export const $normal = { kind: "normal" } as const

/** D13, D306: `catch` recovers the first expected failure of a cause with no defect, as `Effect.catch` does (the kernel's `catchExpected`). */
export const $catch: <A, E, R, B, E2, R2>(
  self: Effect.Effect<A, E, R>,
  handler: (error: E) => Effect.Effect<B, E2, R2>
) => Effect.Effect<A | B, E2, R | R2> = K.catchExpected

/**
 * A catch expression (D236): `program catch fallback` and
 * `program catch (e) => handler`. The parser passes both sides as functions,
 * so the left side runs inside the catch and a fallback runs only after an
 * expected failure; defects and interrupts pass through, as `catch (e)`
 * statements let them.
 */
export const $catchExpression = <A, E, R, B, E2, R2>(
  self: () => Effect.Effect<A, E, R>,
  handler: (error: E) => Effect.Effect<B, E2, R2>
): Effect.Effect<A | B, E2, R | R2> => K.catchExpected(Effect.suspend(self), handler)

/**
 * A typed catch clause, `catch (e: NotFound)`, tests the caught failure with
 * the _tag of each type it names (D131); the compiler passes the tags. The
 * form is retired (D216) but still compiles, with the warning EK2112.
 */
export function $isFailure<T>(value: unknown, ...tags: ReadonlyArray<string>): value is T {
  return typeof value === "object" && value !== null && tags.includes((value as { readonly _tag?: unknown })._tag as string)
}

/** `finally`: runs on every exit; a failure inside it is never dropped (D15; onExit merges causes). */
export const $finally = <A, E, R, X, E2, R2>(
  self: Effect.Effect<A, E, R>,
  finalizer: Effect.Effect<X, E2, R2>
): Effect.Effect<A, E | E2, R | R2> => Effect.onExit(self, () => Effect.asVoid(finalizer))

/** A block with `using` or `fork`: a Scope region whose Scope is not put in the Context (D14). */
export const $region = <A, E, R>(body: (scope: Scope.Scope) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.scopedWith(body)

/**
 * `using x = e` (D342, D401, D490) is one Effect program for every
 * initializer, whatever `e`'s type: `Effect.acquireRelease(e, release,
 * { interruptible: true })` with the block's Scope. Its `restore` runs `e`
 * with the interruptibility in force where the `using` stands, as `yield* e`
 * runs it, so an interruption reaches a pause in `e` exactly where it would
 * reach the same pause in a statement before the `using`, and `using`
 * registers nothing. Each acquisition inside `e` keeps its own policy:
 * Effect's default `acquireRelease` and `acquireDisposable` mask their
 * acquire, and `{ interruptible: true }` does not. `using` adds no mask of its
 * own.
 *
 * `release` is the value's one disposal (releaseOf), chosen once, when the
 * acquire ends and before Effect registers it in the uninterruptible step
 * that ends the acquisition, so no interruption separates the value from it
 * (scopes-using-pending-interrupt). `requiresScope`, which the compiler
 * passes, decides only releaseOf's last case: whether a value with no
 * disposal method is bound as it is or is a TypeError. The content mapper,
 * which reads no types, passes no options, and so binds such a value.
 */
export const $using = <A, E, R>(
  scope: Scope.Scope,
  acquire: Effect.Effect<A, E, R>,
  options?: { readonly requiresScope?: boolean }
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> => {
  const requiresScope = options?.requiresScope ?? true
  const owned = Effect.map(acquire, (value) => ({ value, release: releaseOf(scope, value, requiresScope) }))
  const acquisition = Effect.acquireRelease(owned, (held) => held.release, { interruptible: true })
  return Effect.map(Scope.provide(acquisition, scope), (held) => held.value)
}

/**
 * The one release of `value`, the value of a `using` initializer, in `scope`
 * (D401): nothing when an acquisition recorded that it registered the
 * value's release there, nothing for `null` or `undefined`, and otherwise
 * the disposal method, read once, now: `[Symbol.asyncDispose]` if the value
 * has one, else `[Symbol.dispose]` (D343), called with the value as `this`,
 * waiting for a promise it returns. A value with no disposal method is
 * released by what its acquisition registered when the initializer requires
 * Scope, and is otherwise a `TypeError`, as ECMAScript's `using` makes it.
 */
const releaseOf = (scope: Scope.Scope, value: unknown, requiresScope: boolean): Effect.Effect<void> => {
  if (value === null || value === undefined || isRecorded(scope, value)) return Effect.void
  const dispose = disposalMethod(value)
  if (dispose !== undefined) {
    return Effect.suspend(() => {
      const result: unknown = Reflect.apply(dispose, value, [])
      return isPromiseLike(result) ? Effect.promise(() => result) : Effect.void
    })
  }
  if (requiresScope) return Effect.void
  throw new TypeError("The value of a using declaration must be Disposable, AsyncDisposable, null, or undefined")
}

/**
 * `value`'s disposal method, as ECMAScript's `await using` reads it
 * (`GetDisposeMethod`, D343): `[Symbol.asyncDispose]` if present, else
 * `[Symbol.dispose]`, each read once. A method that is present but not a
 * function is a `TypeError`.
 */
const disposalMethod = (value: unknown): ((this: unknown) => unknown) | undefined => {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined
  const resource = value as { readonly [Symbol.asyncDispose]?: unknown; readonly [Symbol.dispose]?: unknown }
  let method = resource[Symbol.asyncDispose]
  if (method === undefined || method === null) method = resource[Symbol.dispose]
  if (method === undefined || method === null) return undefined
  if (typeof method !== "function") throw new TypeError("A using value's disposal method is not a function")
  return method as (this: unknown) => unknown
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  ((typeof value === "object" && value !== null) || typeof value === "function") &&
  typeof (value as { readonly then?: unknown }).then === "function"

/**
 * D54: a failure in flight in a function that compiles to plain JavaScript,
 * which a catch of the function recovers: the cause a frame would carry, with
 * the expected failure a catch receives. Plain code throws every other cause
 * as one JavaScript value, which its catches pass through as a defect.
 */
class ExpectedFailure {
  constructor(readonly error: unknown, private readonly whole?: Cause.Cause<unknown>) {}
  get cause(): Cause.Cause<unknown> {
    return this.whole ?? Cause.fail(this.error)
  }
}

type Suppressed = Error & { readonly error: unknown; readonly suppressed: unknown }
type SuppressedConstructor = new (error: unknown, suppressed: unknown, message?: string) => Suppressed

/** ECMAScript's SuppressedError, or the runtime's own where the host lacks it (D340). */
const SuppressedError: SuppressedConstructor = (globalThis as { SuppressedError?: SuppressedConstructor }).SuppressedError ??
  class SuppressedError extends Error {
    constructor(readonly error: unknown, readonly suppressed: unknown, message?: string) {
      super(message)
      this.name = "SuppressedError"
    }
  }

// The cause that each SuppressedError the runtime made stands for (D340).
const joined = new WeakMap<object, Cause.Cause<unknown>>()

/**
 * D340: the exception that leaves plain code for a cause with a defect. A
 * plain function never fails, so only defects leave it, and two failures
 * leave as a `SuppressedError` whose `error` is the later one and whose
 * `suppressed` is the earlier, as ECMA-262's DisposeResources reports them.
 * The runtime records the cause it stands for, its failures elected to
 * defects (D305), and turns it back into that cause where it reaches plain
 * code's catch or finally, or an Effect frame ($joinedFrame, $joinedSync).
 */
const defectFor = (cause: Cause.Cause<unknown>): unknown => {
  const values = cause.reasons.flatMap((reason) => Cause.isFailReason(reason) ? [reason.error] : Cause.isDieReason(reason) ? [reason.defect] : [])
  let thrown = values[0]
  for (let i = 1; i < values.length; i++) {
    thrown = new SuppressedError(values[i], thrown, "A cleanup failed while another failure was in flight")
    joined.set(thrown as Suppressed, K.electDefects(Cause.fromReasons(cause.reasons.slice(0, i + 1))))
  }
  return thrown
}

// The JavaScript value a thrown value stands for once a defect is present.
const defectOf = (thrown: unknown): unknown => thrown instanceof ExpectedFailure ? defectFor(thrown.cause) : thrown

/** D54: `throw e` in a function that compiles to plain JavaScript throws `$expected(e)`. */
export const $expected = (error: unknown): unknown => new ExpectedFailure(error)

/**
 * D404, D340: a native for...of in plain code whose iterator's return() throws
 * while a failure is in flight (the compiler's closing.go). The two join, the
 * pending failure first, as `$finally`'s Effect.onExit combines causes,
 * rather than IteratorClose's keeping only the first: a catch outside
 * recovers the first expected failure, and a defect on either side makes the
 * whole a defect, which leaves as a `SuppressedError` whose `error` is
 * return()'s exception and whose `suppressed` is the pending one. A plain
 * finally block keeps JavaScript's meaning and never reaches this (VIP-4).
 * pending is `$normal` when no failure was in flight.
 */
export const $finallyFailure = (pending: unknown, thrown: unknown): unknown => {
  if (pending === $normal) return thrown
  const cause = Cause.combine(causeOf(pending), causeOf(thrown))
  if (!cause.reasons.some(Cause.isDieReason)) {
    const failure = cause.reasons.find(Cause.isFailReason) as Cause.Fail<unknown>
    return new ExpectedFailure(failure.error, cause)
  }
  const suppressed = new SuppressedError(defectOf(thrown), defectOf(pending), "A cleanup failed while another failure was in flight")
  joined.set(suppressed, K.electDefects(cause))
  return suppressed
}

// The cause a value thrown in plain code stands for: an expected failure's,
// a SuppressedError's that the runtime made, and otherwise a defect.
const causeOf = (thrown: unknown): Cause.Cause<unknown> =>
  thrown instanceof ExpectedFailure ? thrown.cause : joinedCause(thrown) ?? Cause.die(thrown)

const joinedCause = (thrown: unknown): Cause.Cause<unknown> | undefined =>
  typeof thrown === "object" && thrown !== null ? joined.get(thrown) : undefined

// D446: the plain form that a plain function's Effect form records on the
// program it returns, bound to the call's receiver and arguments.
const plainForm: unique symbol = Symbol.for("vibelang/plainForm")

/**
 * The Effect form of a function that compiles to plain JavaScript,
 * `function f(...args) { return $plainSync(f$direct, this, args) }`. Its
 * program runs the plain form as `Effect.sync` does, and fails with the
 * cause a SuppressedError the runtime made stands for, so the caller sees
 * what the frame lowering of the same code gives (D340). It records the
 * plain form where `$plainOf` reads it (D446).
 */
export const $plainSync = <A>(direct: (...args: Array<any>) => A, self: unknown, args: ArrayLike<unknown>): Effect.Effect<A> => {
  const plain = (): A => Reflect.apply(direct, self, args)
  const program = Effect.suspend(() => {
    try {
      return Exit.succeed(plain())
    } catch (thrown) {
      const cause = joinedCause(thrown)
      if (cause === undefined) throw thrown
      return Exit.failCause(cause) as unknown as Exit.Exit<A>
    }
  })
  Object.defineProperty(program, plainForm, { value: plain })
  return program
}

/**
 * D446: a plain function's plain form, for a call or a value from another
 * module: `f[$direct]` once f's module has attached it. Before that, as in
 * a module cycle, a function that calls the hoisted f, which builds a cold
 * program and runs none of it, and then calls the plain form the program
 * recorded once, synchronously, in plain code and Effect code alike: no
 * fiber starts, no runner runs, and no module's body evaluates early. A
 * function that records no plain form, an Effect function, gives its program
 * back, which an Effect caller runs on its own fiber.
 */
export const $plainOf = (f: unknown): unknown => {
  if (typeof f !== "function") return f
  const attached = (f as { [$direct]?: unknown })[$direct]
  if (attached !== undefined) return attached
  return function(this: unknown, ...args: Array<unknown>) {
    const direct = (f as { [$direct]?: (...args: Array<unknown>) => unknown })[$direct]
    if (direct !== undefined) return Reflect.apply(direct, this, args)
    const program = Reflect.apply(f, this, args) as { [plainForm]?: () => unknown } | undefined
    const plain = program?.[plainForm]
    // D495 withdraws the Effect-form fallback described above: a missing
    // plain form is a defect at this call.
    if (plain === undefined) throw new TypeError(`Plain call of ${f.name || "<anonymous>"} found no plain form for its declared plain signature`)
    return plain()
  }
}

/**
 * D340: a generated frame that calls plain code which can throw a
 * SuppressedError the runtime made. Effect makes an exception that leaves a
 * frame one defect; this adapter instead fails the frame with the cause the
 * SuppressedError stands for, as the frame lowering of the same code would.
 * A frame that threw is finished, so Effect, which runs the failure, never
 * resumes it.
 */
export const $joinedFrame = <F extends (...args: any[]) => Generator<Effect.Effect<any, any, any>, any, any>>(body: F): F => {
  const wrapped = function(this: unknown, ...args: Parameters<F>) {
    const iterator = Reflect.apply(body, this, args) as Generator<Effect.Effect<any, any, any>, any, any>
    const step = (resume: () => IteratorResult<Effect.Effect<any, any, any>, any>): IteratorResult<Effect.Effect<any, any, any>, any> => {
      try {
        return resume()
      } catch (thrown) {
        const cause = joinedCause(thrown)
        if (cause === undefined) throw thrown
        return { done: false, value: Effect.failCause(cause) }
      }
    }
    return {
      next: (value?: unknown) => step(() => iterator.next(value)),
      throw: (error?: unknown) => step(() => iterator.throw(error)),
      return: (value?: unknown) => iterator.return(value),
      [Symbol.iterator]() {
        return this
      }
    }
  }
  Object.defineProperty(wrapped, "length", { value: body.length, configurable: true })
  Object.defineProperty(wrapped, "name", { value: body.name, configurable: true })
  return wrapped as unknown as F
}

/**
 * D54, D13: a catch in a function that compiles to plain JavaScript starts
 * with `e = $caught(e)`. It returns the expected failure, and rethrows
 * anything else, a defect, so the catch never sees it.
 */
export const $caught = (thrown: unknown): unknown => {
  if (thrown instanceof ExpectedFailure) return thrown.error
  throw thrown
}

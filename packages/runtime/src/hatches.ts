import { Effect, Exit } from "effect"

// The boundary hatches (D148): `sync` and `callback` run plain
// TypeScript inside VibeLang. In a .vibe file a hatch's first argument is not
// VibeLang: calls do not run, `throw`, `async`, and `await` keep their
// JavaScript meaning, and platform APIs are allowed. That TypeScript is
// self-contained (D229): values reach it as inputs, the arguments after the
// function, which fill its first parameters (D230); an async function then
// receives the AbortSignal, and a callback `resume` and the signal. The
// compiler lowers `sync` to Effect's own functions and reads the overload it
// chose by the first parameter's name (evaluate or value); the function
// itself decides between sync and async by its type (D232). A throw that is
// an expected failure goes through Effect's own Effect.try or
// Effect.tryPromise, which replaced the `try` hatch (VIP-5). These implementations serve
// TypeScript callers and a hatch passed as a value. They see no types, so
// they decide by the function's declaration: an async function that
// declares a parameter after its inputs gets the AbortSignal there, and
// interruption aborts it; any other function gets its inputs only, and a
// promise it returns is awaited without a signal. A direct hatch calls an
// async function through $asyncHatch as well, so both follow one rule; the
// compiler also withholds the signal when the overload TypeScript chose
// gives the function its inputs alone.

/** The inputs a hatch passes to its function's first parameters (D230). */
type Inputs = ReadonlyArray<unknown>

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" && value !== null || typeof value === "function") && typeof (value as { readonly then?: unknown }).then === "function"

const call = (evaluate: unknown, inputs: Inputs): unknown => (evaluate as (...args: Array<unknown>) => unknown)(...inputs)

/**
 * Whether evaluate is declared async, the only kind of function the
 * runtime's sync passes an AbortSignal (D232). An async generator
 * function is not: it returns a generator, not a promise.
 */
const isAsyncFunction = (evaluate: unknown): evaluate is Function =>
  Object.prototype.toString.call(evaluate) === "[object AsyncFunction]"

/**
 * An async hatch function as the evaluate of Effect.promise
 * (D230, D232): evaluate with exactly its inputs, then the AbortSignal when
 * signal allows one and evaluate declares a parameter for it. Effect.promise
 * makes a signal only for an evaluate that takes one; a rest or defaulted
 * parameter does not count, so it never receives one, nor the undefined
 * Effect passes in its place. The compiler passes signal false when the
 * overload TypeScript chose gives the function its inputs alone; sync
 * called as a value sees no types and passes true.
 */
export const $asyncHatch = (evaluate: Function, signal: boolean, ...inputs: Inputs): (signal: AbortSignal) => PromiseLike<unknown> =>
  signal && evaluate.length > inputs.length
    ? (abort) => call(evaluate, [...inputs, abort]) as PromiseLike<unknown>
    : () => call(evaluate, inputs) as PromiseLike<unknown>

/**
 * D148: `sync((n) => n * 2, count)` is Effect.sync, so a throw is a defect; an
 * async function is Effect.promise, so a rejection is a defect, and it gets
 * the AbortSignal after its inputs when it declares a parameter for it,
 * which interruption aborts; and
 * `sync(expression)` evaluates the expression when the Effect runs. Inputs
 * after the function fill its first parameters (D230). A function that is
 * not async but returns a promise is awaited without a signal (D232).
 */
export function sync<R, Args extends Inputs = []>(evaluate: (...args: [...Args, AbortSignal]) => PromiseLike<R>, ...args: Args): Effect.Effect<R>
export function sync<R, Args extends Inputs = []>(evaluate: (...args: Args) => R, ...args: Args): Effect.Effect<Awaited<R>>
export function sync<A>(value: A): Effect.Effect<Awaited<A>>
export function sync(evaluate: unknown, ...inputs: Array<unknown>): Effect.Effect<unknown> {
  if (typeof evaluate !== "function") {
    return isPromiseLike(evaluate) ? Effect.promise(() => evaluate) : Effect.succeed(evaluate)
  }
  if (isAsyncFunction(evaluate)) return Effect.promise($asyncHatch(evaluate, true, ...inputs))
  return Effect.suspend(() => {
    const result = call(evaluate, inputs)
    return isPromiseLike(result) ? Effect.promise(() => result) : Effect.succeed(result)
  })
}

/**
 * VIP-5: `try p` runs the Effect p where it stands and gives its success
 * value. Before anything but a call, the parser writes it as $try(p), and
 * the lowering writes yield* p, so this identity runs only where TypeScript
 * code calls it.
 */
export const $try = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect

/**
 * The `resume` a `callback` hatch receives. A .vibe file names it without an
 * import, to annotate `resume` where inputs keep callback's type arguments
 * from being written: `callback((source, resume: Resume<number, Error>) => …, source)`.
 */
export interface Resume<A, E> {
  /** Succeeds with value. */
  (value: A): void
  /** Fails with error, an expected failure. */
  readonly fail: (error: E) => void
  /** Ends as exit says. */
  readonly exit: (exit: Exit.Exit<A, E>) => void
}

/**
 * D148: `callback((resume, signal) => …)` is Effect.callback. `resume(value)`
 * succeeds, `resume.fail(error)` fails, and `resume.exit(exit)` adopts an Exit.
 * A returned Effect is the interrupt finalizer; a returned cleanup function
 * runs on interruption and its PromiseLike result is awaited. Inputs
 * after the function fill its first parameters, before `resume` (D230).
 */
export function callback<A, E = never, Args extends Inputs = [], R = never>(
  register: (...args: [...Args, Resume<A, E>, AbortSignal]) => void | (() => void) | (() => PromiseLike<void>) | Effect.Effect<void, never, R>,
  ...args: Args
): Effect.Effect<A, E, R>
export function callback<A, E = never, Args extends Inputs = [], R = never>(register: (...args: [...Args, Resume<A, E>]) => void | (() => void) | (() => PromiseLike<void>) | Effect.Effect<void, never, R>, ...args: Args): Effect.Effect<A, E, R>
export function callback(register: (...args: Array<any>) => unknown, ...args: Inputs): Effect.Effect<unknown, unknown, unknown> {
  return Effect.callback<unknown, unknown, unknown>((resumeEffect, signal) => {
    const resume = ((value: unknown) => resumeEffect(Effect.succeed(value))) as Resume<unknown, unknown> & { fail: unknown; exit: unknown }
    resume.fail = (error: unknown) => resumeEffect(Effect.fail(error))
    resume.exit = (exit: Exit.Exit<unknown, unknown>) => resumeEffect(exit)
    const cleanup = call(register, [...args, resume, signal])
    // D148/S19-30: Effect 4.0.6 internal/effect.ts:1200-1245 aborts first,
    // then runs this finalizer uninterruptibly only on interruption. Pass an
    // Effect through (1250-1256); defer a function so synchronous cleanup keeps
    // its defect semantics and PromiseLike cleanup completes before interrupt.
    if (Effect.isEffect(cleanup)) return cleanup as Effect.Effect<void, never, unknown>
    if (typeof cleanup !== "function") return undefined
    return Effect.suspend(() => {
      const result = cleanup()
      return isPromiseLike(result) ? Effect.promise(() => result).pipe(Effect.asVoid) : Effect.void
    })
  })
}

// The way back in (D148): plain TypeScript, in a .ts file or a hatch's body,
// starts an Effect with these runners.
export { runCallback, runFork, runPromise, runSync } from "effect/Effect"

import { Deferred, Effect, Exit, Fiber, Scope } from "effect"

// The fiber forms of a .vibe file (D166-D170). The parser writes `await x`
// as $await(x), `select { ... }` as a call of $select, and `for concurrent`
// as a call of $forConcurrent; `fork x` is the prelude's fork, whose operand
// the compiler passes as the program its syntax builds (D322, D391).

/** What `await` waits for: a Fiber or a Deferred, or an array or object of them. */
export type Awaitable = Fiber.Fiber<any, any> | Deferred.Deferred<any, any>

type NotAwaitable = Effect.Effect<any, any, any> | PromiseLike<any> | ((...args: never) => unknown)

// Each type parameter is inferred rather than matched against any: a
// Deferred is invariant in its error type, and any is not assignable to never.
type AwaitedLeaf<T> = T extends Fiber.Fiber<infer A, infer _E> ? A : T extends Deferred.Deferred<infer A, infer _E> ? A : never
type AwaitedLeafError<T> = T extends Fiber.Fiber<infer _A, infer E> ? E : T extends Deferred.Deferred<infer _A, infer E> ? E : never
type IsAwaitable<T> = T extends Fiber.Fiber<infer _A, infer _E> ? true : T extends Deferred.Deferred<infer _A, infer _E> ? true : false

/**
 * The value `await x` returns: a Fiber's or a Deferred's value, or an array
 * or object of them with the same shape. never for an operand await cannot
 * wait for (EK4603). Elements must be Fibers or Deferreds themselves.
 */
export type AwaitedValue<T> =
  IsAwaitable<T> extends true ? AwaitedLeaf<T>
  : T extends NotAwaitable ? never
  : T extends readonly unknown[] ? { -readonly [K in keyof T]: AwaitedLeaf<T[K]> }
  : T extends object ? { -readonly [K in keyof T]: AwaitedLeaf<T[K]> }
  : never

/** The failures `await x` can propagate. */
export type AwaitedError<T> =
  IsAwaitable<T> extends true ? AwaitedLeafError<T>
  : T extends NotAwaitable ? never
  : T extends readonly unknown[] ? AwaitedLeafError<T[number]>
  : T extends object ? AwaitedLeafError<T[keyof T]>
  : never

/**
 * D167: `await x` waits for a Fiber (joining it), a Deferred, or every one of
 * an array or object of them, keeping the shape. When one fails, the fibers
 * still running are interrupted and the failure propagates, as Effect.all
 * fails fast.
 */
export function $await<const T>(value: T): Effect.Effect<AwaitedValue<T>, AwaitedError<T>>
// The implementation's return type is any: comparing it with the overload's
// recursive types would instantiate them without bound.
export function $await(value: unknown): any {
  return awaitValue(value)
}

type IsFiber<T> = T extends Fiber.Fiber<infer _A, infer _E> ? true : false
type JoinedLeaf<T> = T extends Fiber.Fiber<infer A, infer _E> ? A : never
type JoinedLeafError<T> = T extends Fiber.Fiber<infer _A, infer E> ? E : never
type NotJoinable = Effect.Effect<any, any, any> | Deferred.Deferred<any, any> | PromiseLike<any> | ((...args: never) => unknown)

/**
 * The value `join x` returns: a Fiber's value, or an array or object of them
 * with the same shape. never for an operand join cannot join (EK4611).
 * Elements must be Fibers themselves.
 */
export type JoinedValue<T> =
  IsFiber<T> extends true ? JoinedLeaf<T>
  : T extends NotJoinable ? never
  : T extends readonly unknown[] ? { -readonly [K in keyof T]: JoinedLeaf<T[K]> }
  : T extends object ? { -readonly [K in keyof T]: JoinedLeaf<T[K]> }
  : never

/** The failures `join x` can propagate. */
export type JoinedError<T> =
  IsFiber<T> extends true ? JoinedLeafError<T>
  : T extends NotJoinable ? never
  : T extends readonly unknown[] ? JoinedLeafError<T[number]>
  : T extends object ? JoinedLeafError<T[keyof T]>
  : never

/**
 * D225: `join x` joins a Fiber (Fiber.join), or every fiber of an array or
 * object of them, keeping the shape. When one fails, the fibers still running
 * are interrupted and the failure propagates, as Effect.all fails fast.
 */
export function $join<const T>(value: T): Effect.Effect<JoinedValue<T>, JoinedError<T>>
// The implementation's return type is any for the same reason as $await's.
export function $join(value: unknown): any {
  return awaitValue(value)
}

/**
 * The prelude's `join`. `join(x)` with parentheses is the keyword `join x`
 * while `join` resolves to this binding (D391), and the binding is used only
 * under its own name (EK4410, D432).
 */
export const join: typeof $join = $join

// An array or object is read once: each element once, in order. The fibers
// it joins are the fibers it interrupts when one fails, so a getter that
// returns another fiber the second time cannot make it join one child and
// interrupt another.
function awaitValue(value: unknown): Effect.Effect<unknown, unknown> {
  if (Fiber.isFiber(value)) return Fiber.join(value)
  if (Deferred.isDeferred(value)) return Deferred.await(value)
  if (typeof value !== "object" || value === null) return Effect.die(new TypeError("await expects a Fiber, a Deferred, or an array or object of them"))
  const fibers: Array<Fiber.Fiber<unknown, unknown>> = []
  return Effect.onError(joinParts(value, fibers), () => Fiber.interruptAll(fibers))
}

// The Effect that waits for each element of value, an array or object of
// Fibers, Deferreds, or arrays or objects of them, keeping its shape. It adds
// each Fiber it joins to fibers.
//
// Effect.all waits for each element in a fiber of its own, which inherits the
// joining fiber's mask. Inside `uninterruptible { }` such a waiter could not
// be interrupted when another element fails, so Effect.all would wait for a
// held fiber forever and never reach the interruptAll above. Each wait is
// interruptible: it runs no program code, and interrupting it stops only the
// wait, not the fiber it waits for.
function joinParts(value: object, fibers: Array<Fiber.Fiber<unknown, unknown>>): Effect.Effect<unknown, unknown> {
  const join = (item: unknown): Effect.Effect<unknown, unknown> => {
    if (Fiber.isFiber(item)) {
      fibers.push(item)
      return Effect.interruptible(Fiber.join(item))
    }
    if (Deferred.isDeferred(item)) return Effect.interruptible(Deferred.await(item))
    if (typeof item !== "object" || item === null) return Effect.die(new TypeError("await expects a Fiber, a Deferred, or an array or object of them"))
    return joinParts(item, fibers)
  }
  if (Array.isArray(value)) return Effect.all(Array.from(value, join), { concurrency: "unbounded" })
  const entries = Object.entries(value).map(([key, item]) => [key, join(item)] as const)
  return Effect.map(
    Effect.all(Object.fromEntries(entries), { concurrency: "unbounded" }),
    (result: Record<string, unknown>) => Object.fromEntries(entries.map(([key]) => [key, result[key]])) // the order written
  )
}

type Program = () => Effect.Effect<any, any, any>

type Index<K> = K extends `${infer N extends number}` ? N : never

/** The winner of a select: the index of its case, in the order written, and its value. */
export type Selected<P extends ReadonlyArray<Program>, D extends boolean> =
  | { [K in keyof P]: { readonly index: Index<K>; readonly value: Effect.Success<ReturnType<P[K]>> } }[number]
  | (D extends true ? { readonly index: -1; readonly value: undefined } : never)

/**
 * D168: `select` starts each case in its own fiber, in the order written,
 * and the first to finish wins: its value is the result, or its failure
 * propagates. The other cases are interrupted. A case that finishes while
 * the cases are starting stops the rest from starting, so of cases that are
 * ready at once, the first written wins. With a default clause, when no case
 * finishes while they start, every case is interrupted and the result's index
 * is -1.
 */
export const $select = <const D extends boolean, const P extends ReadonlyArray<Program>>(
  hasDefault: D,
  ...programs: P
): Effect.Effect<Selected<P, D>, Effect.Error<ReturnType<P[number]>>, Effect.Services<ReturnType<P[number]>>> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      const fibers: Array<Fiber.Fiber<unknown, unknown>> = []
      // Every loser is signalled before any is waited for, so one loser's
      // cleanup can wait for another's (D167, D196).
      const interruptOthers = (winner: number) => Fiber.interruptAll(fibers.filter((_, index) => index !== winner))
      for (let index = 0; index < programs.length; index++) {
        const fiber = yield* Effect.forkChild(Effect.suspend(programs[index]), { startImmediately: true })
        fibers.push(fiber)
        const exit = fiber.pollUnsafe()
        if (exit !== undefined) {
          yield* interruptOthers(index)
          return yield* Effect.map(exit, (value) => ({ index, value }))
        }
      }
      if (hasDefault) {
        yield* interruptOthers(-1)
        return { index: -1, value: undefined }
      }
      const [index, exit] = yield* Effect.onExit(restore(firstExit(fibers)), () => interruptOthers(-1))
      yield* interruptOthers(index)
      return yield* Effect.map(exit, (value) => ({ index, value }))
    })
  ) as any

const firstExit = (fibers: ReadonlyArray<Fiber.Fiber<unknown, unknown>>) =>
  Effect.callback<readonly [number, import("effect").Exit.Exit<unknown, unknown>]>((resume) => {
    let done = false
    const removers = fibers.map((fiber, index) =>
      fiber.addObserver((exit) => {
        if (done) return
        done = true
        resume(Effect.succeed([index, exit] as const))
      })
    )
    return Effect.sync(() => {
      for (const remove of removers) remove()
    })
  })

/**
 * D169: `for concurrent (const x of xs) body` runs the body for each item in
 * its own fiber, at most `concurrency` at once (no limit when undefined), and
 * joins them all before the loop ends. A failure interrupts the rest.
 */
export const $forConcurrent = <X, E, R>(
  items: Iterable<X>,
  concurrency: number | undefined,
  body: (item: X) => Effect.Effect<unknown, E, R>
): Effect.Effect<void, E, R> =>
  Effect.forEach(items, body, { concurrency: concurrency ?? "unbounded", discard: true })

/** D170: starts a program in a fiber that nothing owns (Effect.forkDetach). */
export const detach = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<Fiber.Fiber<A, E>, never, R> =>
  Effect.forkDetach(program)

/** D170: starts a program in a fiber that `scope` owns (Effect.forkIn). */
export const forkIn = <A, E, R>(scope: Scope.Scope, program: Effect.Effect<A, E, R>): Effect.Effect<Fiber.Fiber<A, E>, never, R> =>
  Effect.forkIn(program, scope)

// VIP-18: values are Effects already; constructing the array runs no element.
type TryEffects = ReadonlyArray<Effect.Effect<any, any, any>>
export function $tryAll<const A extends TryEffects>(operand: A): Effect.Effect<
  { -readonly [K in keyof A]: Effect.Success<A[K]> }, Effect.Error<A[number]>, Effect.Services<A[number]>
> {
  return Effect.all(operand, { concurrency: "unbounded" }) as any
}
export function $tryRace<const A extends TryEffects>(operand: A): Effect.Effect<Effect.Success<A[number]>, Effect.Error<A[number]>, Effect.Services<A[number]>> {
  return Effect.raceAllFirst(operand)
}
export function $tryAny<const A extends TryEffects>(operand: A): Effect.Effect<Effect.Success<A[number]>, Effect.Error<A[number]>, Effect.Services<A[number]>> {
  return Effect.raceAll(operand)
}
export function $tryAllSettled<const A extends TryEffects>(operand: A): Effect.Effect<
  number extends A["length"]
    ? Array<Exit.Exit<Effect.Success<A[number]>, Effect.Error<A[number]>>>
    : { -readonly [K in keyof A]: Exit.Exit<Effect.Success<A[K]>, Effect.Error<A[K]>> }, never, Effect.Services<A[number]>
> {
  return Effect.all(operand.map(Effect.exit), { concurrency: "unbounded" }) as any
}

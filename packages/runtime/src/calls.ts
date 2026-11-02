import { Effect } from "effect"

// Generated calls capture their target before operands run, and invoke it
// after those operands. Reading method.bind/call/apply would run user code.
const apply = Reflect.apply
export const $bindMethod = <F extends (...args: Array<any>) => any>(
  method: F, self: unknown
): OmitThisParameter<F> =>
  ((...args: Array<any>) => apply(method, self, args)) as OmitThisParameter<F>

// A computed key before a do is converted where it stands (VIP-2): the
// lowering reads it into a constant there, with this conversion,
// ECMA-262's ToPropertyKey, which a computed key in a literal performs.
const ownKeys = Reflect.ownKeys
export const $propertyKey = (key: unknown): PropertyKey => ownKeys({ [key as PropertyKey]: undefined })[0] as PropertyKey

// A spread before a do runs where it stands (VIP-2): the lowering iterates
// it into an array there, and spreads that array later through this
// iterable, which reads nothing a program can change, as
// Array.prototype[Symbol.iterator] is.
const iterator: typeof Symbol.iterator = Symbol.iterator
export const $spreadItems = <T>(items: ReadonlyArray<T>): Iterable<T> => ({
  [iterator]: (): Iterator<T> => {
    let i = 0
    return {
      next: (): IteratorResult<T> => (i < items.length ? { value: items[i++] as T, done: false } : { value: undefined, done: true }),
    }
  },
})

/** The optimistic first-pass call: run it when it is an Effect, else succeed with it. */
export type Bind<T> = [T] extends [Effect.Effect<infer A, infer E, infer R>] ? Effect.Effect<A, E, R> : Effect.Effect<T, never, never>
export const $bind = <T>(value: T): Bind<T> => (Effect.isEffect(value) ? value : Effect.succeed(value)) as any

/** A program value: a function with no arguments where an Effect is expected (D7). */
export const $program = <A, E, R>(thunk: () => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.suspend(thunk)

/**
 * D49: an iterable or a record of programs where an iterable or a record of
 * Effects is expected. An iterable becomes an array; a record keeps its keys.
 */
export function $programs<P extends () => Effect.Effect<any, any, any>>(programs: Iterable<P>): Array<ReturnType<P>>
export function $programs<R extends Record<string, () => Effect.Effect<any, any, any>>>(
  programs: R
): { [K in keyof R]: ReturnType<R[K]> }
export function $programs(programs: Iterable<() => Effect.Effect<any, any, any>> | Record<string, () => Effect.Effect<any, any, any>>): unknown {
  if (Symbol.iterator in Object(programs)) {
    return Array.from(programs as Iterable<() => Effect.Effect<any, any, any>>, (p) => Effect.suspend(p))
  }
  return Object.fromEntries(Object.entries(programs).map(([key, p]) => [key, Effect.suspend(p)]))
}

export const runMain = <A, E>(program: Effect.Effect<A, E, never>) => Effect.runPromiseExit(program)

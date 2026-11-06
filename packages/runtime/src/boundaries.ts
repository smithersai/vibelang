import * as Effect from "effect/Effect"
import { $expected } from "./regions.js"

/** A class whose instances a trusted call throws as expected failures. */
export type FailureClass<E> = abstract new (...args: any) => E

/**
 * D5, D23: a call whose contract lists expected failures, such as a function
 * tagged `@vibelang trusted` with `@throws {PortError}`, or `JSON.parse`,
 * whose shipped contract lists `SyntaxError`. The compiler passes the listed
 * classes. An exception that is an instance of one of them fails the Effect;
 * any other exception is a defect.
 */
export const $trusted = <A, E>(thunk: () => A, classes: ReadonlyArray<FailureClass<E>>): Effect.Effect<A, E> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(thunk())
    } catch (e) {
      return classes.some((c) => e instanceof c) ? Effect.fail(e as E) : Effect.die(e)
    }
  })

/**
 * D54: the same call inside a `try` with a `catch` in a function that
 * compiles to plain JavaScript. A listed exception is thrown as an expected
 * failure, which the function's `catch` receives; any other propagates as a
 * defect, which it does not.
 */
export const $trustedPlain = <A>(thunk: () => A, classes: ReadonlyArray<FailureClass<unknown>>): A => {
  try {
    return thunk()
  } catch (e) {
    throw classes.some((c) => e instanceof c) ? $expected(e) : e
  }
}

/**
 * D249, D514: the key under which a `trusted` value carries the classes its
 * calls throw as expected failures.
 */
export const $errors: unique symbol = Symbol.for("vibelang/errors")

/**
 * D514: the type of `trusted(impl, [Errors])`: impl's own type, which a
 * TypeScript caller calls as it calls impl, with the listed classes.
 */
export type Trusted<F, Errors extends ReadonlyArray<FailureClass<unknown>>> = F & { readonly [$errors]: Errors }

/**
 * D249, D514: keep a synchronous foreign function's failure contract in its
 * value. The value is one plain function that calls impl with its arguments
 * and returns what impl returns, so a TypeScript caller receives a function
 * of impl's type that throws what impl throws. A VibeLang call of it is a
 * trusted call: an instance of a listed class is an expected failure where
 * the call stands, and any other exception is a defect.
 */
export const trusted = <F extends (...args: any[]) => any, const Classes extends ReadonlyArray<FailureClass<unknown>>>(
  impl: F & (Extract<ReturnType<F>, PromiseLike<unknown> | Effect.Effect<any, any, any>> extends never ? unknown : never),
  classes: Classes
): Trusted<F, Classes> => {
  const call = function (this: unknown, ...args: Array<unknown>) {
    return impl.apply(undefined, args)
  }
  return Object.defineProperty(call, $errors, { value: classes }) as unknown as Trusted<F, Classes>
}

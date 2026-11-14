/**
 * Continue-on-failure fan-out: a failing member is isolated, its siblings
 * run to completion, and the result reports each member as `Succeeded` or
 * `Quarantined`.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { concurrencyRefusal, nonEmptyMembersRefusal } from "./internal.js"
import { PatternError } from "./PatternError.js"

/**
 * What a failing member does to its siblings. `quarantine` isolates it.
 * `halt` is the ordinary join: the first failure interrupts every sibling
 * still running.
 *
 * @category models
 * @since 0.0.13
 */
export type Policy = "quarantine" | "halt"

/**
 * A member that failed and was isolated from its siblings.
 *
 * @category models
 * @since 0.0.13
 */
export interface Quarantined<E> {
  readonly _tag: "Quarantined"
  readonly member: string
  readonly error: E
}

/**
 * A member that completed. The value is nested, so a value of any shape,
 * even one shaped like `Quarantined`, is never read as an outcome.
 *
 * @category models
 * @since 0.0.13
 */
export interface Succeeded<A> {
  readonly _tag: "Succeeded"
  readonly member: string
  readonly value: A
}

/**
 * One member's outcome under the `quarantine` policy.
 *
 * @category models
 * @since 0.0.13
 */
export type Settled<A, E> = Succeeded<A> | Quarantined<E>

/**
 * The options of {@link run}. `concurrency` bounds how many members run at
 * once and defaults to `"unbounded"`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options {
  readonly policy: Policy
  readonly concurrency?: number | "unbounded" | undefined
}

const data = (value: object, key: string): PropertyDescriptor | undefined => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor ? descriptor : undefined
  } catch {
    return undefined
  }
}

const outcome = (value: unknown, tag: "Succeeded" | "Quarantined", payload: "value" | "error"): boolean => {
  if (typeof value !== "object" || value === null) return false
  let keys: ReadonlyArray<string>
  try {
    keys = Object.keys(value)
  } catch {
    return false
  }
  if (keys.length !== 3 || !keys.includes("_tag") || !keys.includes("member") || !keys.includes(payload)) return false
  return data(value, "_tag")?.value === tag && typeof data(value, "member")?.value === "string" &&
    data(value, payload) !== undefined
}

/**
 * Whether a value is a complete `Quarantined` outcome: exactly the own data
 * properties `_tag`, a string `member`, and `error`. It never calls an
 * accessor.
 *
 * @throws never
 * @category refinements
 * @since 0.0.13
 */
export const isQuarantined = (value: unknown): value is Quarantined<unknown> => outcome(value, "Quarantined", "error")

/**
 * Whether a value is a complete `Succeeded` outcome: exactly the own data
 * properties `_tag`, a string `member`, and `value`. It never calls an
 * accessor.
 *
 * @throws never
 * @category refinements
 * @since 0.0.13
 */
export const isSucceeded = (value: unknown): value is Succeeded<unknown> => outcome(value, "Succeeded", "value")

/**
 * Runs a record of Effects under a failure policy.
 *
 * Under `quarantine` every member runs to completion and a failure becomes a
 * `Quarantined` entry; no sibling is interrupted on its behalf. A defect or
 * an interruption still propagates. Under `halt` the first failure
 * interrupts the members still in flight and fails the run, and the result
 * holds plain values.
 *
 * Fails with `PatternError` (`invalid_decorator`) before any member runs when
 * the record is empty or `concurrency` is not `"unbounded"` or a positive
 * safe integer.
 *
 * @category combinators
 * @since 0.0.13
 */
export function run<A, E, R>(
  members: Readonly<Record<string, Effect.Effect<A, E, R>>>,
  options: Options & { readonly policy: "quarantine" }
): Effect.Effect<Readonly<Record<string, Settled<A, E>>>, PatternError, R>
export function run<A, E, R>(
  members: Readonly<Record<string, Effect.Effect<A, E, R>>>,
  options: Options & { readonly policy: "halt" }
): Effect.Effect<Readonly<Record<string, A>>, E | PatternError, R>
export function run<A, E, R>(
  members: Readonly<Record<string, Effect.Effect<A, E, R>>>,
  options: Options
): Effect.Effect<Readonly<Record<string, A | Settled<A, E>>>, E | PatternError, R> {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the record or the options in between must not reach it.
  const declared = Object.entries(members)
  const policy = options.policy
  const concurrency = options.concurrency ?? "unbounded"
  return Effect.suspend((): Effect.Effect<Readonly<Record<string, A | Settled<A, E>>>, E | PatternError, R> => {
    const refusal = nonEmptyMembersRefusal("Quarantine", declared.map(([name]) => name)) ??
      (concurrency === "unbounded" ? undefined : concurrencyRefusal("Quarantine", concurrency))
    if (refusal !== undefined) return Effect.fail(refusal)
    return Effect.map(
      Effect.forEach(
        declared,
        ([member, effect]): Effect.Effect<readonly [string, A | Settled<A, E>], E, R> =>
          policy === "halt"
            ? Effect.map(effect, (value) => [member, value] as const)
            : Effect.match(effect, {
              onFailure: (error): readonly [string, Settled<A, E>] => [
                member,
                Object.freeze({ _tag: "Quarantined", member, error })
              ],
              onSuccess: (value): readonly [string, Settled<A, E>] => [
                member,
                Object.freeze({ _tag: "Succeeded", member, value })
              ]
            }),
        { concurrency }
      ),
      (pairs): Readonly<Record<string, A | Settled<A, E>>> => Object.fromEntries(pairs)
    )
  })
}

/**
 * Turns a `quarantine` result into plain values, failing when any member was
 * quarantined: every member had its chance to run, and one failure still
 * fails the step.
 *
 * Fails with `PatternError`: `invalid_input` naming the entries that are
 * not complete outcomes, and `quarantined` naming the quarantined members,
 * with each member's error kept in `cause`.
 *
 * @category combinators
 * @since 0.0.13
 */
export const settle = <A, E>(
  result: Readonly<Record<string, Settled<A, E>>>
): Effect.Effect<Readonly<Record<string, A>>, PatternError> => {
  const names = Object.keys(result)
  const invalid = names.filter((member) => !isQuarantined(result[member]) && !isSucceeded(result[member]))
  if (invalid.length > 0) {
    return Effect.fail(
      new PatternError({ code: "invalid_input", message: `Invalid quarantine outcomes: ${invalid.sort().join(", ")}` })
    )
  }
  const failures = names.filter((member) => isQuarantined(result[member])).sort()
  if (failures.length > 0) {
    return Effect.fail(
      new PatternError({
        code: "quarantined",
        message: `Quarantined members: ${failures.join(", ")}`,
        cause: failures.map((member) => ({ member, error: (result[member] as Quarantined<E>).error }))
      })
    )
  }
  return Effect.succeed(Object.fromEntries(names.map((member) => [member, (result[member] as Succeeded<A>).value])))
}

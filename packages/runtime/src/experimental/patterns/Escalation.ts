/**
 * An escalation ladder: try each rung in order and stop at the first whose
 * result is good enough, with an optional fallback after the last rung.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { accepted as isAccepted } from "./internal.js"
import { PatternError } from "./PatternError.js"

/**
 * A rung with its own escalation predicate, which overrides `accept`.
 * `escalateIf` receives the rung's result and its level, counted from 0.
 *
 * @category models
 * @since 0.0.13
 */
export interface RuntimeRung<I, A, E, R, E2, R2> {
  readonly run: (input: I) => Effect.Effect<A, E, R>
  readonly escalateIf?: ((result: A, level: number) => Effect.Effect<boolean, E2, R2>) | undefined
}

/**
 * The options of {@link run}. A rung is a function or a {@link RuntimeRung}.
 * With no `escalateIf` and no `accept`, {@link defaultEscalate} decides.
 * `fallback` runs only after every rung escalated.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, A, E, R, E2, R2, F = A, E3 = never, R3 = never> {
  readonly rungs: ReadonlyArray<((input: I) => Effect.Effect<A, E, R>) | RuntimeRung<I, A, E, R, E2, R2>>
  readonly accept?: ((result: A) => Effect.Effect<unknown, E2, R2>) | undefined
  readonly fallback?: ((input: I) => Effect.Effect<F, E3, R3>) | undefined
}

/**
 * The rung that settled and its result. `level` is the rung's index; a
 * fallback result carries the rung count.
 *
 * @category models
 * @since 0.0.13
 */
export interface Reached<A> {
  readonly level: number
  readonly result: A
  readonly exhausted: false
}

/**
 * The last rung's result, when every rung escalated and there is no
 * fallback.
 *
 * @category models
 * @since 0.0.13
 */
export interface Exhausted<A> {
  readonly level: number
  readonly result: A
  readonly accepted: false
  readonly exhausted: true
}

/**
 * How a ladder ends; `exhausted` tells the arms apart.
 *
 * @category models
 * @since 0.0.13
 */
export type Settled<A, F = A> = Reached<A> | Reached<F> | Exhausted<A>

/**
 * Whether an `accept` decision accepts: `true`, `"approved"`, or an object
 * whose own `approved` or `accepted` property is `true`.
 *
 * @throws never
 * @category predicates
 * @since 0.0.13
 */
export const accepted = (decision: unknown): boolean => isAccepted(decision)

/**
 * Decides escalation for a rung with no `escalateIf` in a ladder with no
 * `accept`. A missing result (`undefined` or `null`) escalates, and so does
 * an object with an `error` other than `undefined`, `null` or `false`, with
 * `failed: true`, or with `ok: false`. Anything else settles the ladder.
 *
 * @throws never
 * @category combinators
 * @since 0.0.13
 */
export const defaultEscalate = (result: unknown): boolean => {
  if (result === undefined || result === null) return true
  if (typeof result !== "object") return false
  const row = result as Readonly<Record<string, unknown>>
  if ("error" in row && row["error"] !== undefined && row["error"] !== null && row["error"] !== false) return true
  if (row["failed"] === true) return true
  return row["ok"] === false
}

/**
 * Tries each rung in order and stops at the first that does not escalate.
 * When every rung escalates, `fallback` runs if there is one; otherwise the
 * result is the last rung's, marked `exhausted: true`.
 *
 * Fails with `PatternError` (`invalid_decorator`) when there is no rung.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, A, E, R, E2 = never, R2 = never, F = A, E3 = never, R3 = never>(
  input: I,
  options: Options<I, A, E, R, E2, R2, F, E3, R3>
): Effect.Effect<Settled<A, F>, E | E2 | E3 | PatternError, R | R2 | R3> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the array, a rung, or the options in between must not reach it.
  const rungs = options.rungs.map((rung): RuntimeRung<I, A, E, R, E2, R2> =>
    typeof rung === "function" ? { run: rung } : { run: rung.run, escalateIf: rung.escalateIf }
  )
  const accept = options.accept
  const fallback = options.fallback
  if (rungs.length === 0) {
    return Effect.fail(new PatternError({ code: "invalid_decorator", message: "Escalation requires at least one rung" }))
  }
  const escalates = (rung: RuntimeRung<I, A, E, R, E2, R2>, result: A, level: number): Effect.Effect<boolean, E2, R2> => {
    if (rung.escalateIf !== undefined) return rung.escalateIf(result, level)
    if (accept !== undefined) return Effect.map(accept(result), (decision) => !isAccepted(decision))
    return Effect.succeed(defaultEscalate(result))
  }
  return Effect.gen(function*() {
    let last: A | undefined
    let level = 0
    for (const rung of rungs) {
      const result = yield* rung.run(input)
      last = result
      if (!(yield* escalates(rung, result, level))) {
        const settled: Reached<A> = { level, result, exhausted: false }
        return settled
      }
      level = level + 1
    }
    if (fallback !== undefined) {
      const settled: Reached<F> = { level: rungs.length, result: yield* fallback(input), exhausted: false }
      return settled
    }
    const spent: Exhausted<A> = { level: rungs.length - 1, result: last as A, accepted: false, exhausted: true }
    return spent
  })
}

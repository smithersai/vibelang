/**
 * A check suite: independent checks run with a concurrency bound, and their
 * rows reduce to one verdict.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { PatternError } from "./PatternError.js"
import * as Quarantine from "./Quarantine.js"

/**
 * How the checks' outcomes reduce to one verdict.
 *
 * @category models
 * @since 0.0.13
 */
export type Strategy = "all-pass" | "majority" | "any-pass"

/**
 * One check's classified outcome, with its error when there is one.
 *
 * @category models
 * @since 0.0.13
 */
export interface CheckResult {
  readonly id: string
  readonly passed: boolean
  readonly error?: unknown
}

/**
 * The reduced outcome of a suite. `errors` holds each check's error by id,
 * including a falsy tolerated failure; a check without an error has no
 * entry. Errors do not decide the verdict.
 *
 * @category models
 * @since 0.0.13
 */
export interface Verdict {
  readonly passed: ReadonlyArray<string>
  readonly failed: ReadonlyArray<string>
  readonly errors: Readonly<Record<string, unknown>>
  readonly strategy: Strategy
  readonly verdict: boolean
}

/**
 * The options of {@link run}. `checks` is keyed by check id, so two checks
 * cannot share an id, and the checks start in the record's key order.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, Out, E, R> {
  readonly checks: Readonly<Record<string, (input: I) => Effect.Effect<Out, E, R>>>
  readonly strategy: Strategy
  readonly concurrency: number
  readonly continueOnFail: boolean
}

const clear = (error: unknown): boolean => error === undefined || error === null || error === false

/**
 * Whether one check's row is a pass. A missing row (`undefined` or `null`)
 * fails. An object row fails when it carries `passed: false`, `ok: false`,
 * `failed: true`, or an `error` other than `undefined`, `null` or `false`.
 * Anything else passes.
 *
 * @throws never
 * @category introspection
 * @since 0.0.13
 */
export const passed = (row: unknown): boolean => {
  if (row === null || row === undefined) return false
  if (typeof row !== "object") return true
  const record = row as Readonly<Record<string, unknown>>
  if (record["passed"] === false || record["ok"] === false || record["failed"] === true) return false
  return clear(record["error"])
}

const classify = (id: string, row: unknown): CheckResult => {
  const result = { id, passed: passed(row) }
  const error = typeof row === "object" && row !== null ? (row as Readonly<Record<string, unknown>>)["error"] : undefined
  return clear(error) ? result : { ...result, error }
}

/**
 * Classifies a record of check rows, in the order of `ids`, whatever order
 * the checks finished in. An id the record does not own fails.
 *
 * With `quarantineOutcomes` (default `false`) the record is a
 * `Quarantine.run` result under the `quarantine` policy: a `Succeeded` row is
 * unwrapped and classified, a `Quarantined` row fails and keeps its error,
 * and anything else fails.
 *
 * @throws never
 * @category introspection
 * @since 0.0.13
 */
export const rows = (values: unknown, ids: ReadonlyArray<string>, quarantineOutcomes = false): ReadonlyArray<CheckResult> => {
  const record = (typeof values === "object" && values !== null ? values : {}) as Readonly<Record<string, unknown>>
  return ids.map((id): CheckResult => {
    if (!Object.hasOwn(record, id)) return { id, passed: false }
    const row = record[id]
    if (!quarantineOutcomes) return classify(id, row)
    if (Quarantine.isSucceeded(row)) return classify(id, row.value)
    if (Quarantine.isQuarantined(row)) return { id, passed: false, error: row.error }
    return { id, passed: false }
  })
}

/**
 * Reduces classified results to one verdict. `all-pass` needs every check
 * to pass, `majority` more than half, and `any-pass` one. An empty suite
 * never passes.
 *
 * @throws never
 * @category combinators
 * @since 0.0.13
 */
export const verdict = (results: ReadonlyArray<CheckResult>, strategy: Strategy): Verdict => {
  const passing = results.filter((result) => result.passed).map((result) => result.id)
  const failing = results.filter((result) => !result.passed).map((result) => result.id)
  const total = results.length
  const decided = strategy === "any-pass"
    ? passing.length > 0
    : strategy === "majority"
    ? passing.length * 2 > total && total > 0
    : total > 0 && passing.length === total
  const errors = Object.fromEntries(
    results.filter((result) => Object.hasOwn(result, "error")).map((result) => [result.id, result.error])
  )
  return { passed: passing, failed: failing, errors, strategy, verdict: decided }
}

/**
 * Runs every check against the input, at most `concurrency` at a time, and
 * returns the verdict.
 *
 * With `continueOnFail: false` the first failing check fails the suite and
 * interrupts the rest. With `continueOnFail: true` every check runs and a
 * failed one is listed in `failed` with its error in `errors`. A check that
 * succeeds with a failing row is always listed in `failed` and never fails
 * the suite. A defect fails the suite under either setting.
 *
 * Fails with `PatternError` (`invalid_decorator`) before any check runs when
 * the record is empty, `concurrency` is not a positive safe integer, or an
 * id is the empty string.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, Out, E, R>(input: I, options: Options<I, Out, E, R>): Effect.Effect<Verdict, E | PatternError, R> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the record or the options in between must not reach it.
  const declared = Object.entries(options.checks)
  const strategy = options.strategy
  const concurrency = options.concurrency
  const continueOnFail = options.continueOnFail
  if (declared.length === 0) {
    return Effect.fail(new PatternError({ code: "invalid_decorator", message: "CheckSuite requires at least one check" }))
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    return Effect.fail(
      new PatternError({ code: "invalid_decorator", message: "CheckSuite concurrency must be a positive safe integer" })
    )
  }
  if (declared.some(([id]) => id === "")) {
    return Effect.fail(new PatternError({ code: "invalid_decorator", message: "CheckSuite check ids must not be empty" }))
  }
  return Effect.map(
    Effect.forEach(
      declared,
      ([id, check]): Effect.Effect<CheckResult, E, R> => {
        const attempt = Effect.map(check(input), (row) => classify(id, row))
        return continueOnFail
          ? Effect.catch(attempt, (error) => Effect.succeed<CheckResult>({ id, passed: false, error }))
          : attempt
      },
      { concurrency }
    ),
    (results) => verdict(results, strategy)
  )
}

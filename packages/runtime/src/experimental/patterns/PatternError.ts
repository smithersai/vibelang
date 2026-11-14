/**
 * The failure a pattern refuses bad options with, and the failure it settles
 * with when a bound is spent.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Data from "effect/Data"

/**
 * Why a pattern failed. The codes are those of the reference patterns
 * library, so one handler reads both libraries' failures.
 *
 * @category errors
 * @since 0.0.13
 */
export type PatternErrorCode =
  | "missing_slot"
  | "recursion_bound"
  | "envelope_conflict"
  | "invalid_decorator"
  | "invalid_input"
  | "exhausted"
  | "stalled"
  | "quarantined"
  | "compensation_failed"

/**
 * A pattern's own failure. It is in the error channel of every `run`, so a
 * caller claims it with `catch`.
 *
 * @category errors
 * @since 0.0.13
 */
export class PatternError extends Data.TaggedError("PatternError")<{
  readonly code: PatternErrorCode
  readonly message: string
  readonly cause?: unknown
}> {}

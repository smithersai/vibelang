/**
 * Checks and vocabulary the patterns share.
 *
 * @internal
 */
import { PatternError } from "./PatternError.js"
import * as Stall from "./Stall.js"

/**
 * Whether `value` has an own property `key` whose value is `true`.
 *
 * @throws never
 * @internal
 */
export const ownTrue = (value: unknown, key: string): boolean =>
  typeof value === "object" && value !== null && Object.hasOwn(value, key) &&
  (value as Readonly<Record<string, unknown>>)[key] === true

/**
 * The shared acceptance vocabulary, read from own properties only: `true`,
 * `"approved"`, or an object whose own `approved` or `accepted` is `true`.
 *
 * @throws never
 * @internal
 */
export const accepted = (value: unknown): boolean =>
  value === true || value === "approved" || ownTrue(value, "approved") || ownTrue(value, "accepted")

/**
 * Refuses a concurrency bound that is not a positive safe integer.
 *
 * @throws never
 * @internal
 */
export const concurrencyRefusal = (pattern: string, concurrency: number): PatternError | undefined =>
  Number.isSafeInteger(concurrency) && concurrency >= 1 ? undefined : new PatternError({
    code: "invalid_decorator",
    message: `${pattern} concurrency must be a positive safe integer, received ${concurrency}`
  })

/**
 * Refuses a member record that holds nothing.
 *
 * @throws never
 * @internal
 */
export const nonEmptyMembersRefusal = (pattern: string, names: ReadonlyArray<string>): PatternError | undefined =>
  names.length === 0
    ? new PatternError({ code: "invalid_decorator", message: `${pattern} requires at least one member` })
    : undefined

/**
 * Refuses a member priority that is not a safe integer, before a pattern
 * sorts or runs the member.
 *
 * @throws never
 * @internal
 */
export const safeIntegerPriorityRefusal = (
  pattern: string,
  member: string,
  value: unknown
): PatternError | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) ? undefined : new PatternError({
    code: "invalid_decorator",
    message: `${pattern} priority for member "${member}" must be a safe integer, received ${value}`
  })

/**
 * Validates a pattern's stall options: `undefined` when there is no breaker,
 * and a `PatternError` when `rounds` is not a safe integer of at least 2.
 *
 * @throws never
 * @internal
 */
export const stallPolicy = (
  pattern: string,
  options: Stall.Options | undefined
): Stall.Policy | PatternError | undefined => {
  if (options === undefined) return undefined
  return Stall.policy(options) ?? new PatternError({
    code: "invalid_decorator",
    message: `${pattern} stall rounds must be a safe integer of at least 2`
  })
}

/**
 * The failure a stall breaker with `on: "escalate"` ends a loop with.
 *
 * @throws never
 * @internal
 */
export const escalated = (pattern: string, rounds: number): PatternError =>
  new PatternError({ code: "stalled", message: `${pattern} stalled: the same result for ${rounds} rounds in a row` })

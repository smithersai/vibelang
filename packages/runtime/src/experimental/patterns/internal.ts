/**
 * Checks and vocabulary the patterns share.
 *
 * @internal
 */
import { PatternError } from "./PatternError.js"

const ownTrue = (value: unknown, key: string): boolean =>
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

/**
 * Quota parking: whether a provider's refusal is a window a durable run waits
 * out, and until when. The classification half of Smithers' `QuotaPolicy`,
 * read from Effect's `AiError`: Effect's provider clients already turn a
 * `Retry-After` header into `RateLimitError.retryAfter`, so no text is parsed
 * here.
 *
 * @internal
 */
import * as AiError from "effect/ai/AiError"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Schema from "effect/Schema"

/**
 * Where a park's deadline came from: the reset instant the provider named,
 * the delay it named, or the default for a rate limit that names neither.
 */
export const ParkSource = Schema.Literals(["reset", "retry-after", "default"])

/** One classified refusal: the epoch instant to ask again, and its source. */
export const Park = Schema.Struct({ wakeAt: Schema.Number, source: ParkSource })
export type Park = typeof Park.Type

/** How long a rate limit that names no deadline parks: a minute. */
export const defaultWaitMillis = 60_000

/**
 * The longest wait a refusal may buy before it stays a failure: an hour. A
 * run that parks for a day cannot be told from a run that hung.
 */
export const maxWaitMillis = 3_600_000

/** The most times one call parks before its refusal fails the step. */
export const maxParks = 8

/**
 * Whether a failure is a capacity refusal, a rate limit or an exhausted
 * quota. It reads the error alone, so a replay of a recorded refusal answers
 * the same; whether and until when to park is the clock's, and is recorded.
 */
export const isCapacity = (error: unknown): boolean =>
  AiError.isAiError(error) && (error.reason._tag === "RateLimitError" || error.reason._tag === "QuotaExhaustedError")

/**
 * The park a failure earns, or `null` when it is not a window: a rate limit
 * waits until its `retryAfter`, or a minute; an exhausted quota waits only
 * when it names its `resetAt`, since otherwise it needs someone to act; any
 * other failure, and any window over {@link maxWaitMillis}, stays a failure.
 * A deadline already past is a park of zero. `nowMillis` is passed in so the
 * caller records the decision against its own clock.
 */
export const classify = (error: unknown, nowMillis: number): Park | null => {
  if (!AiError.isAiError(error)) return null
  const reason = error.reason
  let park: Park
  if (reason._tag === "RateLimitError") {
    park = reason.retryAfter === undefined
      ? { wakeAt: nowMillis + defaultWaitMillis, source: "default" }
      : { wakeAt: nowMillis + Duration.toMillis(reason.retryAfter), source: "retry-after" }
  } else if (reason._tag === "QuotaExhaustedError" && reason.resetAt !== undefined) {
    park = { wakeAt: DateTime.toEpochMillis(reason.resetAt), source: "reset" }
  } else {
    return null
  }
  return Number.isFinite(park.wakeAt) && park.wakeAt - nowMillis <= maxWaitMillis ? park : null
}

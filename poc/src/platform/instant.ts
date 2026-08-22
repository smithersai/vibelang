/**
 * `Instant`: a point on the wall clock, as whole epoch milliseconds.
 *
 * The type stays exactly what `Clock.now()` has always returned — a `number` —
 * rather than becoming a branded value type. Unifying the two matters more than
 * branding here: `Clock` is the capability that *produces* Instants, every
 * existing caller already treats the reading as epoch milliseconds, and a brand
 * would make `Date.now()`, `TestClock.atInstant(…)`, and every host timestamp
 * un-passable without a conversion the language does not yet have. The trade is
 * explicit: an Instant is transparent, so this module cannot brand it, and every
 * operation validates its arguments instead (non-finite, fractional, or
 * out-of-range readings panic).
 *
 * Instant arithmetic is pure — it takes `Duration`s and needs no capability.
 * Only reading "now" does, and that is `Clock`'s job.
 *
 * Policies:
 * - Whole milliseconds only; a fractional reading is a broken clock and panics.
 * - The representable range is JS's own `Date` range, ±8.64e15 ms. Arithmetic
 *   that leaves it panics rather than producing an `Invalid Date` downstream.
 * - `parse` is strict: a date-time must carry `Z` or a `±HH:MM` offset, which is
 *   then normalized to UTC. A bare `YYYY-MM-DDTHH:MM:SS` is rejected rather than
 *   read as host-local time, and sub-millisecond digits are rejected rather than
 *   silently truncated. Malformed text is a recoverable `InvalidInstant`.
 */

import { type JsonValue, type NominalError, registerErrorCodec } from "../runtime/errors.ts";
import { panic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import type { ValueCodec } from "../runtime/wire.ts";
import { type Duration, durationFromMillis } from "./duration.ts";

const { failure, success } = RuntimeValues;

/** A point in time, as whole milliseconds since the Unix epoch. */
export type Instant = number;

/** JavaScript's own `Date` range; an Instant outside it has no ISO rendering. */
export const MAX_INSTANT: Instant = 8_640_000_000_000_000;
export const MIN_INSTANT: Instant = -8_640_000_000_000_000;

/** Text that is not an ISO-8601 instant this runtime can represent. */
export class InvalidInstant extends Error {
  constructor(
    readonly text: string,
    readonly reason: string,
    message = `Not an ISO-8601 instant (${reason}): ${text}`,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "InvalidInstant";
  }
}
export interface InvalidInstant extends NominalError<"vibelang:InvalidInstant@1"> {}

registerErrorCodec(InvalidInstant, "vibelang:InvalidInstant@1", {
  encode: (error): JsonValue => ({ text: error.text, reason: error.reason, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 3 ||
      typeof payload.text !== "string" || typeof payload.reason !== "string" ||
      typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid InvalidInstant payload");
    }
    return new InvalidInstant(payload.text, payload.reason, payload.message);
  },
});

/** Every entry point funnels through this; an Instant is a plain number and cannot be branded. */
function asInstant(value: Instant, caller: string): Instant {
  if (typeof value !== "number" || Number.isNaN(value)) panic(`${caller} requires an epoch millisecond number, not NaN`);
  if (!Number.isFinite(value)) panic(`${caller} requires a finite epoch millisecond value`);
  if (!Number.isInteger(value)) panic(`${caller} requires a whole number of epoch milliseconds`);
  if (value < MIN_INSTANT || value > MAX_INSTANT) panic(`${caller} is outside the representable instant range`);
  return value === 0 ? 0 : value;
}

function isInstant(value: unknown): value is Instant {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= MIN_INSTANT && value <= MAX_INSTANT
  );
}

function fromEpochMillis(millis: number): Instant {
  return asInstant(millis, "Instant.fromEpochMillis");
}

function toEpochMillis(instant: Instant): number {
  return asInstant(instant, "Instant.toEpochMillis");
}

function fromDate(date: Date): Instant {
  if (!(date instanceof Date)) panic("Instant.fromDate requires a Date");
  return asInstant(date.getTime(), "Instant.fromDate");
}

/** Always a fresh, mutable `Date`; mutating it cannot move the Instant it came from. */
function toDate(instant: Instant): Date {
  return new Date(asInstant(instant, "Instant.toDate"));
}

function plus(instant: Instant, duration: Duration): Instant {
  return asInstant(asInstant(instant, "Instant.plus") + duration.toMillis(), "Instant.plus");
}

function minus(instant: Instant, duration: Duration): Instant {
  return asInstant(asInstant(instant, "Instant.minus") - duration.toMillis(), "Instant.minus");
}

/** The span from `instant` to `other`; negative when `other` is earlier. */
function until(instant: Instant, other: Instant): Duration {
  const from = asInstant(instant, "Instant.until");
  const to = asInstant(other, "Instant.until");
  return durationFromMillis(to - from, "Instant.until");
}

function compare(left: Instant, right: Instant): number {
  const first = asInstant(left, "Instant.compare");
  const second = asInstant(right, "Instant.compare");
  return first < second ? -1 : first > second ? 1 : 0;
}

function lessThan(left: Instant, right: Instant): boolean {
  return compare(left, right) < 0;
}

function greaterThan(left: Instant, right: Instant): boolean {
  return compare(left, right) > 0;
}

function equals(left: Instant, right: Instant): boolean {
  return compare(left, right) === 0;
}

function min(left: Instant, right: Instant): Instant {
  return compare(left, right) <= 0 ? asInstant(left, "Instant.min") : asInstant(right, "Instant.min");
}

function max(left: Instant, right: Instant): Instant {
  return compare(left, right) >= 0 ? asInstant(left, "Instant.max") : asInstant(right, "Instant.max");
}

/** Canonical ISO-8601 in UTC with milliseconds, matching `Date.prototype.toISOString`. */
function format(instant: Instant): string {
  return new Date(asInstant(instant, "Instant.format")).toISOString();
}

// The offset group is optional in the pattern but required by `parse`, so a
// bare `YYYY-MM-DDTHH:MM:SS` gets the specific "missing UTC offset" reason
// rather than a generic shape complaint.
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function invalid(text: string, reason: string): Result<Instant, InvalidInstant> {
  return failure(new InvalidInstant(text, reason));
}

/**
 * Strict ISO-8601. Accepts `YYYY-MM-DD` (midnight UTC) and
 * `YYYY-MM-DDTHH:MM[:SS[.sss]](Z|±HH:MM)`, normalizing any offset to UTC.
 */
function parse(text: string): Result<Instant, InvalidInstant> {
  if (typeof text !== "string") panic("Instant.parse requires a string");
  const match = ISO.exec(text);
  if (match === null) {
    return invalid(text, text.includes("T") ? "expected YYYY-MM-DDTHH:MM:SS.sss±HH:MM" : "expected YYYY-MM-DD");
  }
  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  if (hour !== undefined && offset === undefined) return invalid(text, "missing UTC offset");

  const millisText = fraction ?? "";
  if (millisText.length > 3 && /[^0]/.test(millisText.slice(3))) {
    return invalid(text, "sub-millisecond precision is not representable");
  }

  const numbers = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour ?? "0"),
    minute: Number(minute ?? "0"),
    second: Number(second ?? "0"),
    millis: millisText === "" ? 0 : Number(millisText.slice(0, 3).padEnd(3, "0")),
  };
  if (numbers.month < 1 || numbers.month > 12) return invalid(text, "month is out of range");
  if (numbers.day < 1 || numbers.day > 31) return invalid(text, "day is out of range");
  if (numbers.hour > 23) return invalid(text, "hour is out of range");
  if (numbers.minute > 59) return invalid(text, "minute is out of range");
  // A leap second has no epoch-millisecond representation, so 60 is rejected too.
  if (numbers.second > 59) return invalid(text, "second is out of range");

  // `setUTCFullYear` rather than `Date.UTC`: the latter maps years 0-99 into the
  // 1900s, which would silently misplace an early-first-century timestamp.
  const rebuilt = new Date(0);
  rebuilt.setUTCFullYear(numbers.year, numbers.month - 1, numbers.day);
  rebuilt.setUTCHours(numbers.hour, numbers.minute, numbers.second, numbers.millis);
  // An impossible calendar date rolls forward; the round-trip catches it.
  if (
    rebuilt.getUTCFullYear() !== numbers.year ||
    rebuilt.getUTCMonth() !== numbers.month - 1 ||
    rebuilt.getUTCDate() !== numbers.day
  ) {
    return invalid(text, "day is out of range for that month");
  }

  let epochMillis = rebuilt.getTime();
  if (offset !== undefined && offset !== "Z") {
    const sign = offset.startsWith("-") ? -1 : 1;
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return invalid(text, "UTC offset is out of range");
    epochMillis -= sign * (offsetHours * 3_600_000 + offsetMinutes * 60_000);
  }
  if (!Number.isFinite(epochMillis) || epochMillis < MIN_INSTANT || epochMillis > MAX_INSTANT) {
    return invalid(text, "outside the representable instant range");
  }
  return success(epochMillis === 0 ? 0 : epochMillis);
}

function decodeEpochMillis(payload: JsonValue): Instant {
  if (
    payload === null || Array.isArray(payload) || typeof payload !== "object" ||
    Object.keys(payload).length !== 1 || typeof payload.epochMillis !== "number"
  ) {
    throw new TypeError("invalid Instant payload");
  }
  if (!isInstant(payload.epochMillis)) {
    throw new TypeError("Instant payload is not a whole number of epoch milliseconds in range");
  }
  return payload.epochMillis === 0 ? 0 : payload.epochMillis;
}

/**
 * The canonical wire form, `{"epochMillis": <integer>}`. Like `Duration.codec`
 * it is handed to `encodeResult`/`decodeResult` explicitly: the runtime keeps a
 * registry for Error identities, not for value codecs.
 */
const codec: ValueCodec<Instant> = Object.freeze({
  encode: (instant: Instant): JsonValue => ({ epochMillis: asInstant(instant, "Instant.codec.encode") }),
  decode: decodeEpochMillis,
});

export const Instant = Object.freeze({
  fromEpochMillis,
  toEpochMillis,
  fromDate,
  toDate,
  plus,
  minus,
  until,
  compare,
  lessThan,
  greaterThan,
  equals,
  min,
  max,
  format,
  parse,
  /** A validity check, not a brand: an Instant is a transparent number. */
  isInstant,
  codec,
});

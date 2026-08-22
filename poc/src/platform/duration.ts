/**
 * `Duration`: a pure span of time.
 *
 * Duration arithmetic needs no capability — only *reading* a clock does (see
 * docs/src/pages/reference/standard-library.mdx, "Configuration and Time"), so
 * nothing in this module touches `Context`.
 *
 * A Duration is an immutable, frozen, non-forgeable value: its milliseconds live
 * in a module-private `WeakMap` and every instance is registered in a
 * module-private `WeakSet`, exactly the way `Result` and `Optional` brand theirs
 * in ../runtime. A structural look-alike therefore cannot be passed off as a
 * Duration; every operation panics on one.
 *
 * Policies, all deliberate and all tested:
 * - **Canonical unit** — a Duration is a whole number of milliseconds. A
 *   constructor whose computed value is fractional panics rather than silently
 *   truncating: sub-millisecond precision is not representable here.
 * - **Negative durations are legal.** A span is signed, because `Instant.until`
 *   must be able to report that the other instant is in the past. Constructors
 *   accept a negative magnitude; only non-finite and NaN inputs are rejected.
 * - **Overflow panics.** Every construction and every arithmetic result must
 *   land within ±`Number.MAX_SAFE_INTEGER` milliseconds, so a Duration never
 *   carries a value whose integer arithmetic has already lost precision.
 *
 * Rejection is a panic rather than a `Result` because a non-finite duration is a
 * programming error, not a recoverable failure — the same call the platform
 * services make for an unusable argument.
 */

import type { JsonValue } from "../runtime/errors.ts";
import type { Optional } from "../runtime/optional.ts";
import { panic } from "../runtime/panic.ts";
import { RuntimeValues } from "../runtime/values.ts";
import type { ValueCodec } from "../runtime/wire.ts";

const { absent, present } = RuntimeValues;

/** The widest span whose millisecond arithmetic is still exact. */
export const MAX_DURATION_MILLIS = Number.MAX_SAFE_INTEGER;

const MILLIS_PER_SECOND = 1_000;
const MILLIS_PER_MINUTE = 60_000;
const MILLIS_PER_HOUR = 3_600_000;
const MILLIS_PER_DAY = 86_400_000;

const millisByDuration = new WeakMap<object, number>();
const localDurations = new WeakSet<object>();

function millisOf(duration: Duration): number {
  const millis = millisByDuration.get(duration as object);
  if (millis === undefined || !localDurations.has(duration as object)) panic("forged Duration value");
  return millis;
}

/**
 * The single gate every Duration millisecond value passes through. `-0` is
 * normalized to `0` so equality, rendering, and the wire codec are canonical.
 */
function checkedMillis(millis: number, caller: string): number {
  if (typeof millis !== "number" || Number.isNaN(millis)) panic(`${caller} requires a number of milliseconds, not NaN`);
  if (!Number.isFinite(millis)) panic(`${caller} requires a finite number of milliseconds`);
  if (!Number.isInteger(millis)) panic(`${caller} requires a whole number of milliseconds`);
  if (Math.abs(millis) > MAX_DURATION_MILLIS) panic(`${caller} overflowed the representable duration range`);
  return millis === 0 ? 0 : millis;
}

export abstract class DurationValue {
  /** The canonical reading: a whole, signed number of milliseconds. */
  toMillis(): number {
    return millisOf(this);
  }

  /** Fractional seconds, for host APIs that measure in them. */
  toSeconds(): number {
    return millisOf(this) / MILLIS_PER_SECOND;
  }

  plus(other: Duration): Duration {
    return makeDuration(checkedMillis(millisOf(this) + millisOf(other), "Duration.plus"));
  }

  minus(other: Duration): Duration {
    return makeDuration(checkedMillis(millisOf(this) - millisOf(other), "Duration.minus"));
  }

  /** Scale the span. A factor that produces a fractional millisecond panics. */
  times(factor: number): Duration {
    if (typeof factor !== "number") panic("Duration.times requires a number");
    return makeDuration(checkedMillis(millisOf(this) * factor, "Duration.times"));
  }

  negated(): Duration {
    return makeDuration(checkedMillis(-millisOf(this), "Duration.negated"));
  }

  /** `-1`, `0`, or `1`; suitable as a comparator. */
  compare(other: Duration): number {
    const left = millisOf(this);
    const right = millisOf(other);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  lessThan(other: Duration): boolean {
    return millisOf(this) < millisOf(other);
  }

  greaterThan(other: Duration): boolean {
    return millisOf(this) > millisOf(other);
  }

  equals(other: Duration): boolean {
    return millisOf(this) === millisOf(other);
  }

  isZero(): boolean {
    return millisOf(this) === 0;
  }

  isNegative(): boolean {
    return millisOf(this) < 0;
  }

  /** Canonical rendering, chosen so that `Duration.parse(d.toString())` returns `d`. */
  toString(): string {
    return render(millisOf(this));
  }

  get [Symbol.toStringTag](): string {
    return "Duration";
  }
}

export type Duration = DurationValue;

class LocalDuration extends DurationValue {
  constructor(millis: number) {
    super();
    millisByDuration.set(this, millis);
    localDurations.add(this);
    Object.freeze(this);
  }
}

function makeDuration(millis: number): Duration {
  return new LocalDuration(millis);
}

const ZERO: Duration = makeDuration(0);

function isDuration(value: unknown): value is Duration {
  return typeof value === "object" && value !== null && localDurations.has(value);
}

const UNIT_MILLIS: Readonly<Record<string, number>> = Object.freeze({
  ms: 1,
  s: MILLIS_PER_SECOND,
  m: MILLIS_PER_MINUTE,
  h: MILLIS_PER_HOUR,
  d: MILLIS_PER_DAY,
});

const RENDER_UNITS: ReadonlyArray<readonly [string, number]> = Object.freeze([
  ["d", MILLIS_PER_DAY],
  ["h", MILLIS_PER_HOUR],
  ["m", MILLIS_PER_MINUTE],
  ["s", MILLIS_PER_SECOND],
  ["ms", 1],
] as ReadonlyArray<readonly [string, number]>);

function render(millis: number): string {
  if (millis === 0) return "0ms";
  const sign = millis < 0 ? "-" : "";
  let rest = Math.abs(millis);
  let rendered = "";
  for (const [unit, size] of RENDER_UNITS) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      rendered += `${count}${unit}`;
      rest -= count * size;
    }
  }
  return sign + rendered;
}

// `ms` must precede `m` and `s` in the alternation so "500ms" is milliseconds.
const BARE_MILLIS = /^\d+$/;
const COMPOUND = /^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d)\s*)+$/;
const COMPONENT = /(\d+(?:\.\d+)?)(ms|s|m|h|d)\s*/g;

/**
 * `"1500ms"`, `"1.5s"`, `"1h30m"`, `"-2h"`, `"7d"`, or a bare integer read as
 * milliseconds. Components are summed and may repeat; units are lowercase.
 *
 * Absence rather than a failure: a parser has no name to blame, so the caller
 * that does — `Config.duration` — is the one that builds the nominal error.
 * Unparsable text, sub-millisecond totals, and out-of-range totals are all
 * absences. Only a non-string argument panics.
 */
function parse(text: string): Optional<Duration> {
  if (typeof text !== "string") panic("Duration.parse requires a string");
  const trimmed = text.trim();
  if (trimmed.length === 0) return absent();
  const negative = trimmed.startsWith("-");
  const body = negative || trimmed.startsWith("+") ? trimmed.slice(1).trim() : trimmed;
  if (body.length === 0) return absent();

  let total: number;
  if (BARE_MILLIS.test(body)) {
    total = Number(body);
  } else {
    if (!COMPOUND.test(body)) return absent();
    total = 0;
    COMPONENT.lastIndex = 0;
    for (let match = COMPONENT.exec(body); match !== null; match = COMPONENT.exec(body)) {
      const size = UNIT_MILLIS[match[2] as string];
      if (size === undefined) return absent();
      total += Number(match[1]) * size;
    }
  }
  if (!Number.isFinite(total) || !Number.isInteger(total) || total > MAX_DURATION_MILLIS) return absent();
  return present(makeDuration(negative ? -total : total));
}

function decodeMillis(payload: JsonValue): number {
  if (
    payload === null || Array.isArray(payload) || typeof payload !== "object" ||
    Object.keys(payload).length !== 1 || typeof payload.millis !== "number"
  ) {
    throw new TypeError("invalid Duration payload");
  }
  const millis = payload.millis;
  if (!Number.isInteger(millis) || Math.abs(millis) > MAX_DURATION_MILLIS) {
    throw new TypeError("Duration payload is not a whole number of milliseconds in range");
  }
  return millis === 0 ? 0 : millis;
}

/**
 * The canonical wire form, `{"millis": <integer>}`.
 *
 * The runtime has no registry for *value* codecs the way it has one for Error
 * identities — `encodeResult`/`encodeOptional` take the codec as an argument —
 * so this is exported explicitly and handed to those functions at the boundary.
 * `decode` throws (rather than panicking) so a malformed payload surfaces as the
 * runtime's `ValueCodecError`, like every other codec failure.
 */
const codec: ValueCodec<Duration> = Object.freeze({
  encode: (duration: Duration): JsonValue => ({ millis: millisOf(duration) }),
  decode: (payload: JsonValue): Duration => makeDuration(decodeMillis(payload)),
});

function unitConstructor(unit: number, caller: string): (value: number) => Duration {
  return (value: number): Duration => {
    if (typeof value !== "number") panic(`${caller} requires a number`);
    return makeDuration(checkedMillis(value * unit, caller));
  };
}

export const Duration = Object.freeze({
  zero: ZERO,
  millis: unitConstructor(1, "Duration.millis"),
  seconds: unitConstructor(MILLIS_PER_SECOND, "Duration.seconds"),
  minutes: unitConstructor(MILLIS_PER_MINUTE, "Duration.minutes"),
  hours: unitConstructor(MILLIS_PER_HOUR, "Duration.hours"),
  days: unitConstructor(MILLIS_PER_DAY, "Duration.days"),
  parse,
  isDuration,
  /** Namespace form of the instance comparator, for `array.sort(Duration.compare)`. */
  compare: (left: Duration, right: Duration): number => left.compare(right),
  codec,
});

/** Internal seam for `Instant`; keeps the brand construction in one module. */
export function durationFromMillis(millis: number, caller: string): Duration {
  return makeDuration(checkedMillis(millis, caller));
}

import { describe, expect, test } from "bun:test";
import { decodeError, encodeError, errorIs } from "../runtime/errors.ts";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { decodeResult, encodeResult } from "../runtime/wire.ts";
import { Clock, SystemClock, TestClock } from "./clock.ts";
import { Duration } from "./duration.ts";
import { Instant, InvalidInstant, MAX_INSTANT, MIN_INSTANT } from "./instant.ts";

const { success } = RuntimeValues;

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

function reasonOf(result: Result<Instant, InvalidInstant>): string {
  return result.match({ ok: () => "<parsed>", error: (error) => error.reason });
}

const NOON = Date.parse("2026-08-20T12:00:00.000Z");

describe("Instant", () => {
  test("is the epoch-millisecond reading Clock already produces", () => {
    const clock = TestClock.at("2026-08-20T12:00:00Z");
    const instant = Instant.fromEpochMillis(clock.now());
    expect(instant).toBe(NOON);
    expect(Instant.toEpochMillis(instant)).toBe(NOON);
    expect(Instant.format(instant)).toBe("2026-08-20T12:00:00.000Z");
    // Clock.instant() is the same reading, validated.
    expect(clock.instant()).toBe(clock.now());
    expect(SystemClock.make().instant()).toBeGreaterThan(0);
    expect(Instant.isInstant(clock.now())).toBe(true);
  });

  test("Clock.instant() resolves through a Layer and stays in step with now()", () => {
    const clock = TestClock.at("2026-08-20T12:00:00Z");
    const reading = (): Instant => Clock.context().instant();
    expect(Layer.provide(Layer.succeed(Clock, clock), reading)).toBe(NOON);
    clock.advance(90_000);
    expect(Layer.provide(Layer.succeed(Clock, clock), reading)).toBe(NOON + 90_000);
    expect(Instant.format(clock.instant())).toBe(clock.iso());
    // Reading time still needs the capability; the arithmetic below never does.
    expect(panics(reading)).toBe(true);
  });

  test("plus, minus, and until are pure Duration arithmetic", () => {
    const start = Instant.fromEpochMillis(NOON);
    const later = Instant.plus(start, Duration.minutes(90));
    expect(Instant.format(later)).toBe("2026-08-20T13:30:00.000Z");
    expect(Instant.minus(later, Duration.minutes(90))).toBe(start);
    expect(Instant.plus(start, Duration.zero)).toBe(start);
    // A negative Duration moves backwards, and `until` reports direction.
    expect(Instant.plus(start, Duration.hours(-2))).toBe(Instant.minus(start, Duration.hours(2)));
    expect(Instant.until(start, later).equals(Duration.minutes(90))).toBe(true);
    expect(Instant.until(later, start).toMillis()).toBe(-5_400_000);
    expect(Instant.until(start, start).isZero()).toBe(true);
  });

  test("comparisons and min/max order points in time", () => {
    const start = Instant.fromEpochMillis(NOON);
    const later = Instant.plus(start, Duration.seconds(1));

    expect(Instant.compare(start, later)).toBe(-1);
    expect(Instant.compare(later, start)).toBe(1);
    expect(Instant.compare(start, Instant.fromEpochMillis(NOON))).toBe(0);
    expect(Instant.lessThan(start, later)).toBe(true);
    expect(Instant.greaterThan(later, start)).toBe(true);
    expect(Instant.equals(start, Instant.fromEpochMillis(NOON))).toBe(true);
    expect(Instant.equals(start, later)).toBe(false);
    expect(Instant.min(later, start)).toBe(start);
    expect(Instant.max(later, start)).toBe(later);
  });

  test("unusable readings panic and the representable range is enforced", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, MAX_INSTANT + 1, MIN_INSTANT - 1]) {
      expect(panics(() => Instant.fromEpochMillis(value))).toBe(true);
      expect(Instant.isInstant(value)).toBe(false);
    }
    expect(panics(() => Instant.fromEpochMillis("0" as unknown as number))).toBe(true);
    expect(Instant.fromEpochMillis(MAX_INSTANT)).toBe(MAX_INSTANT);
    expect(Instant.fromEpochMillis(MIN_INSTANT)).toBe(MIN_INSTANT);

    // Arithmetic that would leave the range panics rather than producing an
    // Instant with no ISO rendering.
    expect(panics(() => Instant.plus(MAX_INSTANT, Duration.millis(1)))).toBe(true);
    expect(panics(() => Instant.minus(MIN_INSTANT, Duration.millis(1)))).toBe(true);
    expect(panics(() => Instant.until(0, Number.NaN))).toBe(true);
    expect(panics(() => Instant.plus(1.5, Duration.zero))).toBe(true);
    expect(panics(() => Instant.plus(0, Duration.millis(1_000) as unknown as never))).toBe(false);
    // A clock that reports a fractional millisecond is a broken clock.
    class FractionalClock extends Clock {
      now(): Instant { return 0.5; }
      monotonic(): number { return 0; }
      date(): Date { return new Date(0); }
    }
    expect(panics(() => new FractionalClock().instant())).toBe(true);
  });

  test("parse normalizes every timezone offset to UTC", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["2026-08-20T12:00:00Z", "2026-08-20T12:00:00.000Z"],
      ["2026-08-20T14:00:00+02:00", "2026-08-20T12:00:00.000Z"],
      ["2026-08-20T07:00:00-05:00", "2026-08-20T12:00:00.000Z"],
      ["2026-08-20T12:00:00+00:00", "2026-08-20T12:00:00.000Z"],
      ["2026-08-20T12:00:00-00:00", "2026-08-20T12:00:00.000Z"],
      ["2026-08-20T12:00:00.123Z", "2026-08-20T12:00:00.123Z"],
      ["2026-08-20T12:00:00.123000Z", "2026-08-20T12:00:00.123Z"],
      ["2026-08-20T12:00Z", "2026-08-20T12:00:00.000Z"],
      ["2026-08-20T23:30:00+05:30", "2026-08-20T18:00:00.000Z"],
      ["2026-08-20", "2026-08-20T00:00:00.000Z"],
      ["2026-01-01T00:30:00+01:00", "2025-12-31T23:30:00.000Z"],
      ["1970-01-01T00:00:00Z", "1970-01-01T00:00:00.000Z"],
      ["1969-12-31T23:59:59.999Z", "1969-12-31T23:59:59.999Z"],
      ["2024-02-29T12:00:00Z", "2024-02-29T12:00:00.000Z"],
      ["9999-12-31T23:59:59.999Z", "9999-12-31T23:59:59.999Z"],
      // Years 0-99 are the case `Date.UTC` maps into the 1900s.
      ["0001-01-01T00:00:00Z", "0001-01-01T00:00:00.000Z"],
      ["0099-12-31T00:00:00Z", "0099-12-31T00:00:00.000Z"],
    ];
    for (const [text, expected] of cases) {
      const parsed = Instant.parse(text);
      expect(parsed.isOk()).toBe(true);
      expect(Instant.format(parsed.unwrapOr(-1))).toBe(expected);
    }
    // Offsets that name the same point produce the identical Instant.
    expect(Instant.parse("2026-08-20T14:00:00+02:00").unwrapOr(-1))
      .toBe(Instant.parse("2026-08-20T12:00:00Z").unwrapOr(-2));
    // format/parse is a round trip in both directions.
    const instant = Instant.fromEpochMillis(NOON + 123);
    expect(Instant.parse(Instant.format(instant)).unwrapOr(-1)).toBe(instant);
    expect(Instant.parse("1970-01-01T00:00:00Z").unwrapOr(-1)).toBe(0);
  });

  test("parse rejects ambiguous, malformed, and unrepresentable text as InvalidInstant", () => {
    // A bare local date-time is the dangerous case: JS would read it as host time.
    expect(reasonOf(Instant.parse("2026-08-20T12:00:00"))).toBe("missing UTC offset");
    expect(reasonOf(Instant.parse("2026-08-20T12:00"))).toBe("missing UTC offset");
    expect(reasonOf(Instant.parse("2026-08-20T12:00:00.1234Z"))).toBe("sub-millisecond precision is not representable");
    expect(reasonOf(Instant.parse("2026-02-30T00:00:00Z"))).toBe("day is out of range for that month");
    expect(reasonOf(Instant.parse("2025-02-29T00:00:00Z"))).toBe("day is out of range for that month");
    expect(reasonOf(Instant.parse("2026-13-01T00:00:00Z"))).toBe("month is out of range");
    expect(reasonOf(Instant.parse("2026-08-00T00:00:00Z"))).toBe("day is out of range");
    expect(reasonOf(Instant.parse("2026-08-20T24:00:00Z"))).toBe("hour is out of range");
    expect(reasonOf(Instant.parse("2026-08-20T12:60:00Z"))).toBe("minute is out of range");
    // A leap second has no epoch-millisecond representation.
    expect(reasonOf(Instant.parse("2016-12-31T23:59:60Z"))).toBe("second is out of range");
    expect(reasonOf(Instant.parse("2026-08-20T12:00:00+24:00"))).toBe("UTC offset is out of range");
    expect(reasonOf(Instant.parse("2026-08-20T12:00:00+02:60"))).toBe("UTC offset is out of range");

    for (const text of ["", "not-a-date", "2026/08/20", "20-08-2026", "2026-8-20T12:00:00Z", "2026-08-20 12:00:00Z"]) {
      const failed = Instant.parse(text);
      expect(failed.isError()).toBe(true);
      expect(errorIs(failed.match({ ok: () => new Error("unreachable"), error: (error) => error }), InvalidInstant))
        .toBe(true);
    }
    // The offending text is carried on the error for the caller to report.
    const error = Instant.parse("nope").match({ ok: () => undefined, error: (failure) => failure });
    expect(error?.text).toBe("nope");
    expect(error?.message).toContain("nope");
    expect(panics(() => Instant.parse(NOON as unknown as string))).toBe(true);
  });

  test("InvalidInstant survives the wire codec and stays nominal", () => {
    const original = new InvalidInstant("2026-08-20T12:00:00", "missing UTC offset");
    const decoded = decodeError(encodeError(original));
    expect(decoded.constructor).toBe(InvalidInstant);
    expect(errorIs(decoded, InvalidInstant)).toBe(true);
    expect((decoded as InvalidInstant).text).toBe(original.text);
    expect((decoded as InvalidInstant).reason).toBe(original.reason);
    expect(decoded.message).toBe(original.message);
    expect(errorIs(decoded, TypeError)).toBe(false);
  });

  test("Date conversions hand back fresh values", () => {
    const instant = Instant.fromEpochMillis(NOON);
    const date = Instant.toDate(instant);
    expect(date.toISOString()).toBe("2026-08-20T12:00:00.000Z");
    date.setTime(0);
    // Mutating the borrowed Date cannot move the Instant it came from.
    expect(Instant.format(instant)).toBe("2026-08-20T12:00:00.000Z");
    expect(Instant.fromDate(new Date(NOON))).toBe(instant);
    expect(panics(() => Instant.fromDate(new Date(Number.NaN)))).toBe(true);
    expect(panics(() => Instant.fromDate(NOON as unknown as Date))).toBe(true);
  });

  test("the wire codec round-trips through the runtime's Result envelope", () => {
    const wire = encodeResult(success(Instant.fromEpochMillis(NOON)), Instant.codec);
    expect(wire).toBe('{"version":1,"kind":"success","value":{"epochMillis":1787227200000}}');
    expect(decodeResult(wire, Instant.codec).unwrapOr(-1)).toBe(NOON);
    expect(Instant.codec.encode(0)).toEqual({ epochMillis: 0 });
    expect(Instant.codec.decode({ epochMillis: -1 })).toBe(-1);
    for (const payload of [{ epochMillis: 1.5 }, { epochMillis: "0" }, { epochMillis: MAX_INSTANT + 1 }, {}, null, 0]) {
      expect(() => Instant.codec.decode(payload as never)).toThrow();
    }
    expect(panics(() => Instant.codec.encode(Number.NaN))).toBe(true);
  });
});

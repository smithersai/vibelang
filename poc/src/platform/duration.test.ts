import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { decodeResult, encodeResult } from "../runtime/wire.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { Duration, DurationValue, MAX_DURATION_MILLIS } from "./duration.ts";

const { success } = RuntimeValues;

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

describe("Duration", () => {
  test("constructors convert to the canonical millisecond reading", () => {
    expect(Duration.millis(250).toMillis()).toBe(250);
    expect(Duration.seconds(90).toMillis()).toBe(90_000);
    expect(Duration.minutes(2).toMillis()).toBe(120_000);
    expect(Duration.hours(1).toMillis()).toBe(3_600_000);
    expect(Duration.days(1).toMillis()).toBe(86_400_000);
    expect(Duration.zero.toMillis()).toBe(0);
    expect(Duration.seconds(1.5).toMillis()).toBe(1_500);
    expect(Duration.seconds(0.1).toMillis()).toBe(100);
    expect(Duration.seconds(2.5).toSeconds()).toBe(2.5);
  });

  test("a Duration is frozen and immutable; arithmetic returns new values", () => {
    const base = Duration.seconds(30);
    expect(Object.isFrozen(base)).toBe(true);
    const later = base.plus(Duration.seconds(15));
    expect(later.toMillis()).toBe(45_000);
    // The receiver is untouched by every operation.
    expect(base.toMillis()).toBe(30_000);
    expect(base.minus(Duration.seconds(10)).toMillis()).toBe(20_000);
    expect(base.times(3).toMillis()).toBe(90_000);
    expect(base.negated().toMillis()).toBe(-30_000);
    expect(base.toMillis()).toBe(30_000);
    // No public writable surface: assigning to the instance cannot change it.
    expect(() => {
      (base as unknown as { millis: number }).millis = 1;
    }).toThrow();
    expect(base.toMillis()).toBe(30_000);
  });

  test("negative durations are legal and arithmetic is signed", () => {
    const back = Duration.seconds(-5);
    expect(back.toMillis()).toBe(-5_000);
    expect(back.isNegative()).toBe(true);
    expect(back.negated().toMillis()).toBe(5_000);
    expect(Duration.seconds(3).plus(back).toMillis()).toBe(-2_000);
    expect(Duration.seconds(3).minus(Duration.seconds(10)).toMillis()).toBe(-7_000);
    expect(back.times(-2).toMillis()).toBe(10_000);
    expect(Duration.millis(-0).toMillis()).toBe(0);
    // -0 normalizes, so a zero built either way is one canonical value.
    expect(Object.is(Duration.seconds(-0).toMillis(), 0)).toBe(true);
    expect(Duration.zero.isZero()).toBe(true);
    expect(back.isZero()).toBe(false);
  });

  test("comparisons order by signed milliseconds", () => {
    const short = Duration.seconds(1);
    const long = Duration.minutes(1);
    const negative = Duration.seconds(-1);

    expect(short.compare(long)).toBe(-1);
    expect(long.compare(short)).toBe(1);
    expect(short.compare(Duration.millis(1_000))).toBe(0);
    expect(short.lessThan(long)).toBe(true);
    expect(long.greaterThan(short)).toBe(true);
    expect(short.equals(Duration.millis(1_000))).toBe(true);
    expect(short.equals(long)).toBe(false);
    expect(negative.lessThan(Duration.zero)).toBe(true);
    // Equality is by value, not identity: two constructions of the same span match.
    expect(Duration.hours(1).equals(Duration.minutes(60))).toBe(true);
    expect([long, negative, short].sort(Duration.compare).map((duration) => duration.toMillis()))
      .toEqual([-1_000, 1_000, 60_000]);
  });

  test("non-finite, NaN, and sub-millisecond inputs panic in every constructor", () => {
    for (const build of [Duration.millis, Duration.seconds, Duration.minutes, Duration.hours, Duration.days]) {
      expect(panics(() => build(Number.NaN))).toBe(true);
      expect(panics(() => build(Number.POSITIVE_INFINITY))).toBe(true);
      expect(panics(() => build(Number.NEGATIVE_INFINITY))).toBe(true);
      expect(panics(() => build("5" as unknown as number))).toBe(true);
      expect(panics(() => build(undefined as unknown as number))).toBe(true);
    }
    // Sub-millisecond precision is not representable, so it is rejected rather
    // than silently truncated.
    expect(panics(() => Duration.millis(0.5))).toBe(true);
    expect(panics(() => Duration.seconds(0.0001))).toBe(true);
    expect(panics(() => Duration.millis(1).times(0.5))).toBe(true);
    expect(panics(() => Duration.millis(1).times(Number.NaN))).toBe(true);
    expect(panics(() => Duration.millis(1).times("2" as unknown as number))).toBe(true);
  });

  test("overflow past the exact-integer range panics instead of losing precision", () => {
    const max = Duration.millis(MAX_DURATION_MILLIS);
    expect(max.toMillis()).toBe(Number.MAX_SAFE_INTEGER);
    expect(panics(() => Duration.millis(MAX_DURATION_MILLIS + 2))).toBe(true);
    expect(panics(() => Duration.days(1e15))).toBe(true);
    expect(panics(() => max.plus(Duration.millis(2)))).toBe(true);
    expect(panics(() => max.negated().minus(Duration.millis(2)))).toBe(true);
    expect(panics(() => max.times(2))).toBe(true);
    // Just inside the range still works.
    expect(max.minus(Duration.millis(1)).toMillis()).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  test("parse reads the canonical rendering back, including compound and negative spans", () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ["0ms", 0],
      ["1500ms", 1_500],
      ["1.5s", 1_500],
      ["30s", 30_000],
      ["1h30m", 5_400_000],
      ["1h 30m", 5_400_000],
      ["-1h30m", -5_400_000],
      ["+2m", 120_000],
      ["7d", 604_800_000],
      ["30000", 30_000],
      ["  45s  ", 45_000],
    ];
    for (const [text, millis] of cases) {
      expect((Duration.parse(text) ?? Duration.millis(-1)).toMillis()).toBe(millis);
    }

    // toString/parse round-trip over a span that uses every unit.
    const mixed = Duration.millis(90_061_001);
    expect(mixed.toString()).toBe("1d1h1m1s1ms");
    expect((Duration.parse(mixed.toString()) ?? Duration.zero).equals(mixed)).toBe(true);
    expect(Duration.zero.toString()).toBe("0ms");
    expect(mixed.negated().toString()).toBe("-1d1h1m1s1ms");
    expect((Duration.parse(mixed.negated().toString()) ?? Duration.zero).toMillis()).toBe(-90_061_001);
  });

  test("every construction path yields the same zero, negative zero included", () => {
    // `Object.is` and reciprocal arithmetic are the two readings that can tell
    // `-0` from `0`; `toString`, `equals`, `isZero` and the codec cannot, which
    // is why a `-0` leaking out of one constructor stayed invisible.
    const zeros: ReadonlyArray<readonly [string, Duration]> = [
      ["Duration.zero", Duration.zero],
      ["millis(-0)", Duration.millis(-0)],
      ["seconds(-0)", Duration.seconds(-0)],
      ["minutes(-0)", Duration.minutes(-0)],
      ["hours(-0)", Duration.hours(-0)],
      ["days(-0)", Duration.days(-0)],
      ["millis(0).negated()", Duration.millis(0).negated()],
      ["millis(0).times(-1)", Duration.millis(0).times(-1)],
      ["millis(0).plus(millis(-0))", Duration.millis(0).plus(Duration.millis(-0))],
      ["millis(0).minus(millis(0))", Duration.millis(0).minus(Duration.millis(0))],
      ["codec.decode({millis:-0})", Duration.codec.decode({ millis: -0 })],
      // `parse` validates its own input and never reaches `checkedMillis`, so
      // every negative spelling of zero used to come back as `-0` here.
      ...(["-0", "-0ms", "-0s", "-0m", "-0h", "-0d", "-0.0ms", "-0.000s", "-0ms0ms", "-0h0m0s", " -0 "] as const)
        .map((text) => [`parse(${JSON.stringify(text)})`, Duration.parse(text)!] as const),
    ];
    for (const [label, duration] of zeros) {
      expect(duration).toBeDefined();
      expect(`${label}: ${Object.is(duration.toMillis(), -0)}`).toBe(`${label}: false`);
      expect(`${label}: ${1 / duration.toMillis()}`).toBe(`${label}: ${Number.POSITIVE_INFINITY}`);
      expect(duration.toMillis()).toBe(0);
      expect(duration.equals(Duration.zero)).toBe(true);
      expect(duration.isZero()).toBe(true);
      expect(duration.isNegative()).toBe(false);
      expect(duration.toString()).toBe("0ms");
      expect(Duration.codec.encode(duration)).toEqual({ millis: 0 });
    }

    // The other direction: normalizing zero must not have flattened any sign
    // or magnitude that a Duration is required to carry.
    expect(Duration.millis(-1).toMillis()).toBe(-1);
    expect(Duration.millis(0).minus(Duration.millis(1)).toMillis()).toBe(-1);
    expect(Duration.parse("-1ms")!.toMillis()).toBe(-1);
    expect(Duration.parse("-1h30m")!.toMillis()).toBe(-5_400_000);
    expect(Duration.millis(MAX_DURATION_MILLIS).negated().toMillis()).toBe(-MAX_DURATION_MILLIS);
    expect(Duration.millis(-1).isNegative()).toBe(true);
    expect(Duration.millis(-1).toString()).toBe("-1ms");
  });

  test("parse still refuses everything the panicking gate refuses", () => {
    // `parse` bypasses `checkedMillis` by design - it answers absence rather
    // than panicking - so it has to enforce the same range, integer, and
    // finiteness properties itself. This pins that it does.
    expect(Duration.parse(String(MAX_DURATION_MILLIS))!.toMillis()).toBe(MAX_DURATION_MILLIS);
    expect(Duration.parse(`-${MAX_DURATION_MILLIS}`)!.toMillis()).toBe(-MAX_DURATION_MILLIS);
    expect(Duration.parse(String(MAX_DURATION_MILLIS + 1))).toBeUndefined();
    expect(Duration.parse(`-${MAX_DURATION_MILLIS + 1}`)).toBeUndefined();
    expect(Duration.parse("0.5ms")).toBeUndefined();
    expect(Duration.parse("-0.5ms")).toBeUndefined();
    expect(Duration.parse("9007199254740991ms1ms")).toBeUndefined();
  });

  test("unparsable text is `undefined`, not a failure or a panic", () => {
    for (const text of ["", "   ", "abc", "30x", "s30", "1h30", "-", "0.0001s", "1e3ms", "1,5s", "9007199254740993"]) {
      expect(Duration.parse(text)).toBeUndefined();
      expect(Duration.parse(text)?.toMillis()).toBeUndefined();
    }
    // Only a non-string argument is a programming error.
    expect(panics(() => Duration.parse(30 as unknown as string))).toBe(true);
  });

  test("structural fakes are rejected by the brand on every operation", () => {
    const real = Duration.seconds(1);
    const fake = Object.create(DurationValue.prototype) as Duration;
    const structural = { toMillis: () => 1_000 } as unknown as Duration;

    expect(Duration.isDuration(real)).toBe(true);
    expect(Duration.isDuration(fake)).toBe(false);
    expect(Duration.isDuration(structural)).toBe(false);
    expect(Duration.isDuration(1_000)).toBe(false);
    expect(Duration.isDuration(null)).toBe(false);

    expect(panics(() => fake.toMillis())).toBe(true);
    expect(panics(() => real.plus(fake))).toBe(true);
    expect(panics(() => real.minus(structural))).toBe(true);
    expect(panics(() => real.equals(structural))).toBe(true);
    expect(panics(() => real.compare(fake))).toBe(true);
    expect(panics(() => real.lessThan(1_000 as unknown as Duration))).toBe(true);
    expect(panics(() => Duration.codec.encode(structural))).toBe(true);
  });

  test("the wire codec round-trips through the runtime's Result envelope", () => {
    const wire = encodeResult(success(Duration.minutes(90)), Duration.codec);
    expect(wire).toBe('{"version":1,"kind":"success","value":{"millis":5400000}}');
    const decoded = decodeResult(wire, Duration.codec);
    expect(decoded.unwrapOr(Duration.zero).equals(Duration.minutes(90))).toBe(true);
    // A decoded Duration is a real branded value, not a plain object.
    expect(Duration.isDuration(decoded.unwrapOr(Duration.zero))).toBe(true);

    expect(Duration.codec.encode(Duration.millis(-250))).toEqual({ millis: -250 });
    expect(Duration.codec.decode({ millis: -250 }).toMillis()).toBe(-250);
    expect(Duration.codec.decode({ millis: 0 }).isZero()).toBe(true);

    // Malformed payloads throw so the runtime reports a ValueCodecError.
    for (const payload of [{ millis: 1.5 }, { millis: "5" }, { millis: 1, extra: 2 }, {}, null, [1], 5]) {
      expect(() => Duration.codec.decode(payload as never)).toThrow();
    }
    expect(() => decodeResult('{"version":1,"kind":"success","value":{"millis":1.5}}', Duration.codec)).toThrow();
  });

  test("Duration needs no capability: everything above ran outside a Layer scope", () => {
    // Explicit as an assertion of the standard-library rule that pure duration
    // arithmetic requires nothing, unlike reading a clock or the environment.
    expect(Duration.hours(2).plus(Duration.minutes(30)).toString()).toBe("2h30m");
    expect(String(Duration.seconds(5))).toBe("5s");
    expect(Object.prototype.toString.call(Duration.seconds(5))).toBe("[object Duration]");
  });
});

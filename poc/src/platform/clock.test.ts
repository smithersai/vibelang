import { describe, expect, test } from "bun:test";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { Clock, SystemClock, TestClock } from "./clock.ts";

/** Contract every Clock implementation must satisfy, exercised through the abstract type. */
function assertClockContract(clock: Clock): void {
  const first = clock.now();
  expect(Number.isFinite(first)).toBe(true);
  expect(clock.date().getTime()).toBe(first);
  // date() must hand back a fresh value; mutating it cannot move the clock.
  const borrowed = clock.date();
  borrowed.setTime(0);
  expect(clock.now()).toBe(first);
  expect(clock.monotonic()).toBeGreaterThanOrEqual(0);
  expect(clock.monotonic()).toBeGreaterThanOrEqual(0);
}

describe("Clock", () => {
  test("SystemClock satisfies the contract and tracks the host clock", () => {
    const clock: Clock = SystemClock.make();
    assertClockContract(clock);
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1_000);
    const before = clock.monotonic();
    for (let index = 0; index < 1_000; index++) void index;
    expect(clock.monotonic()).toBeGreaterThanOrEqual(before);
  });

  test("TestClock satisfies the contract and only moves when a test moves it", () => {
    const clock = TestClock.at("2026-08-20T12:00:00Z");
    assertClockContract(clock);
    expect(clock.now()).toBe(Date.parse("2026-08-20T12:00:00Z"));
    expect(clock.iso()).toBe("2026-08-20T12:00:00.000Z");
    expect(clock.monotonic()).toBe(0);
    expect(clock.now()).toBe(clock.now());

    clock.advance(1_500);
    expect(clock.iso()).toBe("2026-08-20T12:00:01.500Z");
    expect(clock.monotonic()).toBe(1_500);

    clock.setTo("2020-01-01T00:00:00Z");
    expect(clock.iso()).toBe("2020-01-01T00:00:00.000Z");
    // A wall-clock reset must not rewind the monotonic reading.
    expect(clock.monotonic()).toBe(1_500);
  });

  test("TestClock rejects unusable instants and backwards travel with a panic", () => {
    expect(isPanic(catchPanic(() => TestClock.at("not-a-timestamp"), (error) => error))).toBe(true);
    expect(isPanic(catchPanic(() => TestClock.atInstant(Number.NaN), (error) => error))).toBe(true);
    const clock = TestClock.at("2026-08-20T12:00:00Z");
    expect(isPanic(catchPanic(() => clock.advance(-1), (error) => error))).toBe(true);
    expect(clock.iso()).toBe("2026-08-20T12:00:00.000Z");
  });

  test("Clock resolves through a Layer under its nominal key", () => {
    const clock = TestClock.at("2026-08-20T12:00:00Z");
    const timestamp = (): number => Clock.context().now();
    expect(Layer.provide(Layer.succeed(Clock, clock), timestamp)).toBe(clock.now());
    // Outside the scope the capability is unavailable rather than defaulted.
    expect(isPanic(catchPanic(timestamp, (error) => error))).toBe(true);
  });
});

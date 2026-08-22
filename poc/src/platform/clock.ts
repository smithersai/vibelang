import { Context } from "../runtime/layer.ts";
import { panic } from "../runtime/panic.ts";
import { Instant } from "./instant.ts";

/**
 * The `Instant` type — epoch milliseconds — now lives in ./instant.ts alongside
 * its arithmetic, and is re-exported here so `Clock`'s long-standing readings
 * and the `Instant` namespace are the same type. Instant/Duration arithmetic is
 * pure and needs no capability; *reading* an Instant does.
 */
export type { Instant };

/**
 * Wall-clock and monotonic time. Reading either is platform-sensitive, so both
 * live behind this capability rather than an ambient `Date.now()`.
 */
export abstract class Clock extends Context {
  /** Current wall-clock reading as epoch milliseconds. */
  abstract now(): Instant;

  /**
   * Non-decreasing milliseconds from an implementation-defined origin. Only
   * differences are meaningful; the origin is not related to the epoch.
   */
  abstract monotonic(): number;

  /** Current wall-clock reading as a `Date`. Always a fresh, mutable value. */
  abstract date(): Date;

  /**
   * The same reading as `now()`, validated as an `Instant` so it can be handed
   * straight to `Instant.plus`/`until`/`format`.
   *
   * Concrete on purpose: adding an abstract member would break every existing
   * `Clock` implementation, and an Instant *is* what `now()` already returns —
   * this only checks that the implementation kept the contract (whole,
   * in-range milliseconds) instead of letting a broken reading travel onwards.
   */
  instant(): Instant {
    return Instant.fromEpochMillis(this.now());
  }
}

/** Node/Bun live implementation backed by the host clocks. */
export class SystemClock extends Clock {
  static make(): SystemClock {
    return new SystemClock();
  }

  now(): Instant {
    return Date.now();
  }

  monotonic(): number {
    return performance.now();
  }

  date(): Date {
    return new Date(Date.now());
  }
}

function parseInstant(iso: string, caller: string): Instant {
  if (typeof iso !== "string") panic(`${caller} requires an ISO-8601 timestamp string`);
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) panic(`${caller} received an unparsable timestamp: ${JSON.stringify(iso)}`);
  return parsed;
}

function assertAdvance(millis: number): void {
  if (!Number.isFinite(millis)) panic("TestClock.advance requires a finite number of milliseconds");
  if (millis < 0) panic("TestClock.advance cannot move time backwards");
}

/**
 * Deterministic clock. Time only moves when a test moves it, so a scheduled
 * assertion never races the host clock.
 */
export class TestClock extends Clock {
  #instant: Instant;
  #monotonic = 0;

  private constructor(instant: Instant) {
    super();
    this.#instant = instant;
  }

  /** `TestClock.at("2026-08-20T12:00:00Z")` */
  static at(iso: string): TestClock {
    return new TestClock(parseInstant(iso, "TestClock.at"));
  }

  static atInstant(instant: Instant): TestClock {
    if (!Number.isFinite(instant)) panic("TestClock.atInstant requires a finite epoch millisecond value");
    return new TestClock(instant);
  }

  now(): Instant {
    return this.#instant;
  }

  monotonic(): number {
    return this.#monotonic;
  }

  date(): Date {
    return new Date(this.#instant);
  }

  /** Move both the wall clock and the monotonic reading forward. */
  advance(millis: number): this {
    assertAdvance(millis);
    this.#instant += millis;
    this.#monotonic += millis;
    return this;
  }

  /** Jump the wall clock only; the monotonic reading is unaffected by a clock reset. */
  setTo(iso: string): this {
    this.#instant = parseInstant(iso, "TestClock.setTo");
    return this;
  }

  /** ISO-8601 rendering of the current reading, convenient in assertions. */
  iso(): string {
    return new Date(this.#instant).toISOString();
  }
}

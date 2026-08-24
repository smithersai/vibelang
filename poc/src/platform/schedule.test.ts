import { describe, expect, test } from "bun:test";
import { Layer } from "../runtime/layer.ts";
import { Panic, catchPanic, isPanic, panic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { Clock, TestClock } from "./clock.ts";
import { Duration, MAX_DURATION_MILLIS } from "./duration.ts";
import { Random, SeededRandom } from "./random.ts";
import { nodePlatform, TestPlatform } from "./layers.ts";
import {
  type Operation,
  Schedule,
  ScheduleValue,
  Sleeper,
  SystemSleeper,
  TestSleeper,
} from "./schedule.ts";

const { failure, success } = RuntimeValues;

type ProvidableLayer = Parameters<typeof Layer.provide>[0];

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

/**
 * `Layer.provide` fails closed on an async body where Promise settlement cannot
 * be observed synchronously (Bun today), so every driver call here starts inside
 * a *synchronous* scope. That is exactly the arrangement the drivers are built
 * for: they resolve Clock, the sleeper, and Random before their first `await`.
 */
function started<T>(layer: ProvidableLayer, body: () => Promise<T>): Promise<T> {
  return Layer.provide(layer, () => ({ pending: body() })).pending;
}

async function rejection(body: () => Promise<unknown>): Promise<unknown> {
  try {
    await body();
  } catch (error) {
    return error;
  }
  return undefined;
}

function millisOf(delays: readonly Duration[]): number[] {
  return delays.map((delay) => delay.toMillis());
}

interface Harness {
  readonly platform: ReturnType<typeof TestPlatform.make>;
  readonly sleeper: TestSleeper;
}

/** A deterministic clock, a seeded RNG, and a sleeper that advances the clock. */
function harness(options: { readonly seed?: number } = {}): Harness {
  const platform = TestPlatform.make(options);
  return { platform, sleeper: TestSleeper.make({ clock: platform.clock }) };
}

const BOOM = new Error("boom");

function alwaysFails(counter: { calls: number }): Operation<never, Error> {
  return () => {
    counter.calls += 1;
    return failure(BOOM);
  };
}

function errorOf<A, E extends Error>(result: Result<A, E>): E | undefined {
  return result.match({ ok: () => undefined, error: (error) => error });
}

describe("Schedule values", () => {
  test("constructors validate their arguments and reject forged inputs", () => {
    expect(panics(() => Schedule.spaced(Duration.seconds(-1)))).toBe(true);
    expect(panics(() => Schedule.fixed(Duration.millis(-1)))).toBe(true);
    expect(panics(() => Schedule.upTo(Duration.seconds(-5)))).toBe(true);
    expect(panics(() => Schedule.spaced(1_000 as unknown as Duration))).toBe(true);
    expect(panics(() => Schedule.exponential(Duration.millis(10), 0))).toBe(true);
    expect(panics(() => Schedule.exponential(Duration.millis(10), Number.POSITIVE_INFINITY))).toBe(true);
    expect(panics(() => Schedule.recurs(-1))).toBe(true);
    expect(panics(() => Schedule.recurs(1.5))).toBe(true);
    expect(panics(() => Schedule.spaced(Duration.zero).withMaxDelay(Duration.millis(-1)))).toBe(true);
    expect(panics(() => Schedule.spaced(Duration.zero).jittered(1.5, 0.5))).toBe(true);
    expect(panics(() => Schedule.spaced(Duration.zero).jittered(-0.1))).toBe(true);
    expect(panics(() => Schedule.spaced(Duration.zero).jittered(Number.NaN))).toBe(true);
    expect(panics(() => Schedule.spaced(Duration.zero).and({} as unknown as Schedule))).toBe(true);
    expect(panics(() => Schedule.spaced(Duration.zero).or(null as unknown as Schedule))).toBe(true);
    // Zero is a legal span for every constructor that takes one.
    expect(Schedule.spaced(Duration.zero).preview(2).length).toBe(2);
    expect(Schedule.recurs(0).preview(2).length).toBe(0);
  });

  test("a Schedule is frozen and a structural look-alike cannot be driven", () => {
    const schedule = Schedule.spaced(Duration.seconds(1));
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(Schedule.isSchedule(schedule)).toBe(true);

    const forged = Object.create(ScheduleValue.prototype) as Schedule;
    expect(Schedule.isSchedule(forged)).toBe(false);
    expect(panics(() => forged.initial())).toBe(true);
    expect(panics(() => forged.preview(1))).toBe(true);
    expect(panics(() => schedule.and(forged))).toBe(true);

    // Combinators never mutate the receiver.
    const bounded = schedule.withMaxDelay(Duration.millis(10));
    expect(millisOf(schedule.preview(2))).toEqual([1_000, 1_000]);
    expect(millisOf(bounded.preview(2))).toEqual([10, 10]);
    expect(bounded).not.toBe(schedule);
  });

  test("step is pure: the same state and info always produce the same decision", () => {
    const schedule = Schedule.exponential(Duration.millis(100)).and(Schedule.recurs(2));
    const info = { attempt: 1, elapsed: Duration.zero };
    const first = schedule.step(schedule.initial(), info);
    const again = schedule.step(schedule.initial(), info);

    expect(first.continue).toBe(true);
    expect(first.delay.toMillis()).toBe(100);
    expect(again.delay.toMillis()).toBe(first.delay.toMillis());
    expect(Object.isFrozen(first)).toBe(true);

    // Advancing uses the returned state, never a mutation of the schedule.
    const second = schedule.step(first.state, { attempt: 2, elapsed: Duration.millis(100) });
    expect(second.delay.toMillis()).toBe(200);
    expect(schedule.step(schedule.initial(), info).delay.toMillis()).toBe(100);
  });

  test("step rejects bad info and another schedule's state", () => {
    const recurring = Schedule.recurs(2);
    const spacedOut = Schedule.spaced(Duration.seconds(1));
    const info = { attempt: 1, elapsed: Duration.zero };

    expect(panics(() => recurring.step(recurring.initial(), { attempt: 0, elapsed: Duration.zero }))).toBe(true);
    expect(panics(() => recurring.step(recurring.initial(), { attempt: 1.5, elapsed: Duration.zero }))).toBe(true);
    expect(panics(() => recurring.step(recurring.initial(), { attempt: 1, elapsed: Duration.millis(-1) }))).toBe(true);
    expect(panics(() => recurring.step(recurring.initial(), { attempt: 1, elapsed: 0 as unknown as Duration }))).toBe(true);
    // `spaced` carries `null`, `recurs` carries a count: neither accepts the other's.
    expect(panics(() => recurring.step(spacedOut.initial(), info))).toBe(true);
    expect(panics(() => recurring.preview(-1))).toBe(true);
  });

  test("spaced and fixed differ only once an attempt takes time", () => {
    expect(millisOf(Schedule.spaced(Duration.seconds(1)).preview(3))).toEqual([1_000, 1_000, 1_000]);
    // With instantaneous attempts the two are indistinguishable; the driver test
    // below is where a slow attempt separates them.
    expect(millisOf(Schedule.fixed(Duration.seconds(1)).preview(3))).toEqual([1_000, 1_000, 1_000]);
    expect(Schedule.spaced(Duration.seconds(1)).preview(3).every(Duration.isDuration)).toBe(true);
  });

  test("exponential grows from the step index, rounds, and saturates instead of panicking", () => {
    expect(millisOf(Schedule.exponential(Duration.millis(100)).preview(5))).toEqual([100, 200, 400, 800, 1_600]);
    expect(millisOf(Schedule.exponential(Duration.millis(100), 1.5).preview(4))).toEqual([100, 150, 225, 338]);
    expect(millisOf(Schedule.exponential(Duration.millis(1_000), 0.5).preview(4))).toEqual([1_000, 500, 250, 125]);

    const runaway = millisOf(Schedule.exponential(Duration.days(1), 1_000).preview(4));
    expect(runaway.slice(0, 3)).toEqual([86_400_000, 86_400_000_000, 86_400_000_000_000]);
    expect(runaway[3]).toBe(MAX_DURATION_MILLIS);
  });

  test("recurs bounds the number of recurrences, not the number of attempts", () => {
    expect(Schedule.recurs(3).preview(10).length).toBe(3);
    expect(millisOf(Schedule.recurs(3).preview(10))).toEqual([0, 0, 0]);
    expect(Schedule.recurs(0).preview(10)).toEqual([]);
    expect(millisOf(Schedule.spaced(Duration.millis(50)).and(Schedule.recurs(3)).preview(10)))
      .toEqual([50, 50, 50]);
  });

  test("upTo stops on observed elapsed time and contributes no delay of its own", () => {
    // Alone it has no delay, so under instantaneous attempts elapsed never moves
    // and the budget never expires; paired with a delay it becomes a real one.
    expect(millisOf(Schedule.upTo(Duration.seconds(5)).preview(3))).toEqual([0, 0, 0]);
    expect(millisOf(Schedule.spaced(Duration.seconds(2)).and(Schedule.upTo(Duration.seconds(5))).preview(10)))
      .toEqual([2_000, 2_000, 2_000]);
    expect(Schedule.spaced(Duration.seconds(2)).and(Schedule.upTo(Duration.zero)).preview(10)).toEqual([]);
  });

  test("and intersects: both must continue, and the later delay wins", () => {
    const bounded = Schedule.exponential(Duration.millis(100)).and(Schedule.recurs(4));
    expect(millisOf(bounded.preview(10))).toEqual([100, 200, 400, 800]);

    const both = Schedule.spaced(Duration.millis(300)).and(Schedule.spaced(Duration.millis(700)));
    expect(millisOf(both.preview(2))).toEqual([700, 700]);

    const stopped = Schedule.recurs(1).and(Schedule.spaced(Duration.millis(10)));
    expect(millisOf(stopped.preview(10))).toEqual([10]);
  });

  test("or unions: either may continue, and only the continuing sides pick the delay", () => {
    const union = Schedule.recurs(1).or(Schedule.spaced(Duration.seconds(1)));
    // Step 1 both continue -> min(0, 1000). Afterwards recurs is done, so its
    // stale zero no longer suppresses the delay the live side asks for.
    expect(millisOf(union.preview(4))).toEqual([0, 1_000, 1_000, 1_000]);

    const both = Schedule.spaced(Duration.millis(300)).or(Schedule.spaced(Duration.millis(700)));
    expect(millisOf(both.preview(2))).toEqual([300, 300]);

    const exhausted = Schedule.recurs(2).or(Schedule.recurs(1));
    expect(exhausted.preview(10).length).toBe(2);
  });

  test("withMaxDelay caps the delay and nested caps take the tighter one", () => {
    const capped = Schedule.exponential(Duration.millis(100)).withMaxDelay(Duration.millis(500));
    expect(millisOf(capped.and(Schedule.recurs(5)).preview(10))).toEqual([100, 200, 400, 500, 500]);

    const tighter = capped.withMaxDelay(Duration.millis(250));
    expect(millisOf(tighter.and(Schedule.recurs(4)).preview(10))).toEqual([100, 200, 250, 250]);

    const decision = tighter.step(tighter.initial(), { attempt: 1, elapsed: Duration.zero });
    expect(decision.maxDelay?.toMillis()).toBe(250);
  });

  test("jittered describes a band without drawing anything, and an outer band replaces an inner one", () => {
    const schedule = Schedule.spaced(Duration.seconds(1)).jittered();
    const decision = schedule.step(schedule.initial(), { attempt: 1, elapsed: Duration.zero });
    expect(decision.delay.toMillis()).toBe(1_000);
    expect(decision.jitter).toEqual({ min: 0.8, max: 1.2 });
    // preview is the pure view: the deterministic delays a driver would jitter.
    expect(millisOf(schedule.preview(2))).toEqual([1_000, 1_000]);

    const rewrapped = schedule.jittered(0.5, 2);
    expect(rewrapped.step(rewrapped.initial(), { attempt: 1, elapsed: Duration.zero }).jitter)
      .toEqual({ min: 0.5, max: 2 });

    // The cap is a ceiling on the *final* delay, so it survives either ordering.
    const capThenJitter = Schedule.spaced(Duration.seconds(1)).withMaxDelay(Duration.millis(900)).jittered();
    const jitterThenCap = Schedule.spaced(Duration.seconds(1)).jittered().withMaxDelay(Duration.millis(900));
    for (const schedules of [capThenJitter, jitterThenCap]) {
      const step = schedules.step(schedules.initial(), { attempt: 1, elapsed: Duration.zero });
      expect(step.maxDelay?.toMillis()).toBe(900);
      expect(step.jitter).toEqual({ min: 0.8, max: 1.2 });
    }
  });

  test("toString renders the composed policy", () => {
    expect(Schedule.spaced(Duration.seconds(1)).toString()).toBe("spaced(1s)");
    expect(Schedule.fixed(Duration.minutes(1)).toString()).toBe("fixed(1m)");
    expect(Schedule.exponential(Duration.millis(100)).toString()).toBe("exponential(100ms, x2)");
    expect(Schedule.recurs(3).toString()).toBe("recurs(3)");
    expect(Schedule.upTo(Duration.seconds(30)).toString()).toBe("upTo(30s)");
    expect(Schedule.exponential(Duration.millis(100)).jittered().withMaxDelay(Duration.seconds(5)).and(Schedule.recurs(4)).toString())
      .toBe("(exponential(100ms, x2).jittered(0.8, 1.2).withMaxDelay(5s) and recurs(4))");
    expect(Object.prototype.toString.call(Schedule.recurs(1))).toBe("[object Schedule]");
  });
});

describe("Sleeper", () => {
  test("TestSleeper records every sleep and advances the clock it was given", async () => {
    const clock = TestClock.at("2026-01-01T00:00:00.000Z");
    const sleeper = TestSleeper.make({ clock });

    await sleeper.sleep(Duration.seconds(30));
    await sleeper.sleep(Duration.zero);
    await sleeper.sleep(Duration.minutes(1));

    expect(sleeper.millis).toEqual([30_000, 0, 60_000]);
    expect(sleeper.sleeps.every(Duration.isDuration)).toBe(true);
    expect(clock.iso()).toBe("2026-01-01T00:01:30.000Z");
    expect(clock.monotonic()).toBe(90_000);

    expect(sleeper.reset().millis).toEqual([]);
    // The clock is not rewound by a reset: only the recording is cleared.
    expect(clock.monotonic()).toBe(90_000);
    expect(panics(() => sleeper.sleep(Duration.seconds(-1)))).toBe(true);
    expect(panics(() => TestSleeper.make({ clock: {} as unknown as TestClock }))).toBe(true);
  });

  test("SystemSleeper waits through the host timer, and only it does", async () => {
    const original = globalThis.setTimeout;
    let ambient = 0;
    globalThis.setTimeout = ((callback: () => void, delay?: number): unknown => {
      ambient += 1;
      return (original as unknown as (cb: () => void, ms?: number) => unknown)(callback, delay);
    }) as unknown as typeof globalThis.setTimeout;

    try {
      await SystemSleeper.make().sleep(Duration.millis(1));
      expect(ambient).toBeGreaterThan(0);

      // An injected timer replaces the ambient one entirely.
      const before = ambient;
      let injected = 0;
      await SystemSleeper.make({ timer: (callback) => { injected += 1; callback(); } }).sleep(Duration.millis(5_000));
      expect(injected).toBe(1);
      expect(ambient).toBe(before);
    } finally {
      globalThis.setTimeout = original;
    }

    expect(panics(() => SystemSleeper.make({ timer: 5 as unknown as () => void }))).toBe(true);
    expect(panics(() => SystemSleeper.make().sleep(Duration.millis(-1)))).toBe(true);
  });
});

describe("Schedule.retry", () => {
  test("a first success short-circuits: one call, no sleeping", async () => {
    const { platform, sleeper } = harness();
    let calls = 0;
    const outcome = await started(platform.layer, () =>
      Schedule.retry(Schedule.spaced(Duration.seconds(1)).and(Schedule.recurs(5)), () => {
        calls += 1;
        return success("first try");
      }, { sleeper }));

    expect(calls).toBe(1);
    expect(sleeper.millis).toEqual([]);
    expect(outcome.unwrapOr("")).toBe("first try");
  });

  test("exhaustion returns the last failure after exactly recurs(n) retries", async () => {
    const { platform, sleeper } = harness();
    const counter = { calls: 0 };
    const outcome = await started(platform.layer, () =>
      Schedule.retry(Schedule.spaced(Duration.millis(50)).and(Schedule.recurs(3)), alwaysFails(counter), { sleeper }));

    // recurs(3) is three retries after the first attempt.
    expect(counter.calls).toBe(4);
    expect(sleeper.millis).toEqual([50, 50, 50]);
    expect(outcome.isError()).toBe(true);
    expect(errorOf(outcome)).toBe(BOOM);
  });

  test("recurs(0) never retries", async () => {
    const { platform, sleeper } = harness();
    const counter = { calls: 0 };
    const outcome = await started(platform.layer, () => Schedule.retry(Schedule.recurs(0), alwaysFails(counter), { sleeper }));

    expect(counter.calls).toBe(1);
    expect(sleeper.millis).toEqual([]);
    expect(outcome.isError()).toBe(true);
  });

  test("exponential backoff stops as soon as an attempt succeeds", async () => {
    const { platform, sleeper } = harness();
    let calls = 0;
    const outcome = await started(platform.layer, () =>
      Schedule.retry(
        Schedule.exponential(Duration.millis(100)).withMaxDelay(Duration.millis(300)).and(Schedule.recurs(10)),
        (): Result<number, Error> => {
          calls += 1;
          return calls < 5 ? failure(BOOM) : success(calls);
        },
        { sleeper },
      ));

    expect(calls).toBe(5);
    expect(sleeper.millis).toEqual([100, 200, 300, 300]);
    expect(outcome.unwrapOr(-1)).toBe(5);
    // Elapsed is real to the TestClock, because the sleeper advanced it.
    expect(platform.clock.monotonic()).toBe(900);
  });

  test("fixed keeps the rate while spaced keeps the gap, once attempts take time", async () => {
    const attemptMillis = 400;

    const paced = harness();
    const pacedCounter = { calls: 0 };
    await started(paced.platform.layer, () =>
      Schedule.retry(Schedule.fixed(Duration.seconds(1)).and(Schedule.recurs(3)), () => {
        paced.platform.clock.advance(attemptMillis);
        return alwaysFails(pacedCounter)();
      }, { sleeper: paced.sleeper }));

    // Each attempt burns 400ms of the 1s period, so only 600ms is left to wait.
    expect(paced.sleeper.millis).toEqual([600, 600, 600]);
    expect(paced.platform.clock.monotonic()).toBe(3_400);

    const gapped = harness();
    const gappedCounter = { calls: 0 };
    await started(gapped.platform.layer, () =>
      Schedule.retry(Schedule.spaced(Duration.seconds(1)).and(Schedule.recurs(3)), () => {
        gapped.platform.clock.advance(attemptMillis);
        return alwaysFails(gappedCounter)();
      }, { sleeper: gapped.sleeper }));

    expect(gapped.sleeper.millis).toEqual([1_000, 1_000, 1_000]);
    expect(gapped.platform.clock.monotonic()).toBe(4_600);
  });

  test("an attempt that overruns a fixed boundary is followed immediately", async () => {
    const { platform, sleeper } = harness();
    const counter = { calls: 0 };
    await started(platform.layer, () =>
      Schedule.retry(Schedule.fixed(Duration.seconds(1)).and(Schedule.recurs(3)), () => {
        platform.clock.advance(1_500);
        return alwaysFails(counter)();
      }, { sleeper }));

    expect(sleeper.millis).toEqual([0, 0, 0]);
    expect(counter.calls).toBe(4);
  });

  test("upTo bounds the whole loop by elapsed time, and the driver agrees with preview", async () => {
    const schedule = Schedule.spaced(Duration.seconds(2)).and(Schedule.upTo(Duration.seconds(5)));
    const { platform, sleeper } = harness();
    const counter = { calls: 0 };
    await started(platform.layer, () => Schedule.retry(schedule, alwaysFails(counter), { sleeper }));

    expect(sleeper.millis).toEqual([2_000, 2_000, 2_000]);
    expect(counter.calls).toBe(4);
    expect(sleeper.millis).toEqual(millisOf(schedule.preview(10)));
  });

  test("the operation must return a Result", async () => {
    const { platform, sleeper } = harness();
    const caught = await rejection(() =>
      started(platform.layer, () =>
        Schedule.retry(Schedule.recurs(1), (() => 42) as unknown as Operation<number, Error>, { sleeper })));
    expect(isPanic(caught)).toBe(true);

    // Argument checks happen in the synchronous prologue, so they are throws at
    // the call site rather than a rejected Promise.
    expect(panics(() => Schedule.retry({} as unknown as Schedule, () => success(1), { sleeper }))).toBe(true);
    expect(panics(() => Schedule.retry(Schedule.recurs(1), null as unknown as Operation<number, Error>, { sleeper })))
      .toBe(true);
  });
});

describe("Schedule.retry jitter", () => {
  const SEED = 20_260_821;

  function expectedJitter(baseMillis: number, count: number, seed: number): number[] {
    const oracle = SeededRandom.withSeed(seed);
    return Array.from({ length: count }, () => Math.round(baseMillis * (0.8 + oracle.next() * (1.2 - 0.8))));
  }

  test("a jittered retry is fully determined by the seed", async () => {
    const schedule = Schedule.spaced(Duration.seconds(1)).jittered().and(Schedule.recurs(4));

    async function run(seed: number): Promise<readonly number[]> {
      const { platform, sleeper } = harness({ seed });
      const counter = { calls: 0 };
      await started(platform.layer, () => Schedule.retry(schedule, alwaysFails(counter), { sleeper }));
      expect(counter.calls).toBe(5);
      return sleeper.millis;
    }

    const expected = expectedJitter(1_000, 4, SEED);
    expect(await run(SEED)).toEqual(expected);
    // Same seed, same sequence; a different seed is a different sequence.
    expect(await run(SEED)).toEqual(expected);
    expect(await run(SEED + 1)).not.toEqual(expected);

    for (const millis of expected) {
      expect(millis).toBeGreaterThanOrEqual(800);
      expect(millis).toBeLessThanOrEqual(1_200);
    }
    // The undisturbed policy is a flat second; jitter actually moved it.
    expect(expected.some((millis) => millis !== 1_000)).toBe(true);
  });

  test("a cap bounds the jittered delay, in either construction order", async () => {
    const schedules = [
      Schedule.spaced(Duration.seconds(1)).jittered(1, 4).withMaxDelay(Duration.millis(1_500)),
      Schedule.spaced(Duration.seconds(1)).withMaxDelay(Duration.millis(1_500)).jittered(1, 4),
    ];

    for (const schedule of schedules) {
      const { platform, sleeper } = harness({ seed: SEED });
      const counter = { calls: 0 };
      await started(platform.layer, () => Schedule.retry(schedule.and(Schedule.recurs(6)), alwaysFails(counter), { sleeper }));
      expect(sleeper.millis.length).toBe(6);
      for (const millis of sleeper.millis) {
        expect(millis).toBeGreaterThanOrEqual(1_000);
        expect(millis).toBeLessThanOrEqual(1_500);
      }
      expect(sleeper.millis.some((millis) => millis === 1_500)).toBe(true);
    }
  });

  test("only a jittered schedule requires Random", async () => {
    const clock = TestClock.at("2026-01-01T00:00:00.000Z");
    const sleeper = TestSleeper.make({ clock });
    const clockOnly = Layer.succeed(Clock, clock);
    const plain = Schedule.spaced(Duration.millis(10)).and(Schedule.recurs(2));
    const jittery = plain.jittered();

    const counter = { calls: 0 };
    const outcome = await started(clockOnly, () => Schedule.retry(plain, alwaysFails(counter), { sleeper }));
    expect(outcome.isError()).toBe(true);
    expect(sleeper.millis).toEqual([10, 10]);

    // The same policy with jitter cannot run without the capability, and says so
    // before the operation is ever called.
    const jitterCounter = { calls: 0 };
    const caught = await rejection(() =>
      started(clockOnly, () => Schedule.retry(jittery.and(Schedule.recurs(2)), alwaysFails(jitterCounter), { sleeper })));
    expect(isPanic(caught)).toBe(true);
    expect((caught as Panic).message).toContain("Random");
    expect(jitterCounter.calls).toBe(0);

    // Adding Random is all it takes.
    const withRandom = Layer.merge(clockOnly, Layer.succeed(Random, SeededRandom.withSeed(7)));
    const okCounter = { calls: 0 };
    await started(withRandom, () => Schedule.retry(jittery.and(Schedule.recurs(2)), alwaysFails(okCounter), { sleeper }));
    expect(okCounter.calls).toBe(3);
  });
});

describe("Schedule panic policy", () => {
  test("a returned Panic failure aborts the retry immediately", async () => {
    const { platform, sleeper } = harness();
    let calls = 0;
    const caught = await rejection(() =>
      started(platform.layer, () =>
        Schedule.retry(Schedule.spaced(Duration.millis(10)).and(Schedule.recurs(5)), () => {
          calls += 1;
          return failure(new Panic("broken invariant"));
        }, { sleeper })));

    expect(isPanic(caught)).toBe(true);
    expect((caught as Panic).message).toBe("broken invariant");
    // Not retried, and no delay was ever waited out.
    expect(calls).toBe(1);
    expect(sleeper.millis).toEqual([]);
  });

  test("a thrown Panic propagates and is not retried", async () => {
    const { platform, sleeper } = harness();
    let calls = 0;
    const caught = await rejection(() =>
      started(platform.layer, () =>
        Schedule.retry(Schedule.spaced(Duration.millis(10)).and(Schedule.recurs(5)), () => {
          calls += 1;
          return panic("thrown from the operation");
        }, { sleeper })));

    expect(isPanic(caught)).toBe(true);
    expect(calls).toBe(1);
    expect(sleeper.millis).toEqual([]);
  });

  test("an ordinary exception is not converted into a retryable failure", async () => {
    const { platform, sleeper } = harness();
    let calls = 0;
    const thrown = new Error("not a Result failure");
    const caught = await rejection(() =>
      started(platform.layer, () =>
        Schedule.retry(Schedule.spaced(Duration.millis(10)).and(Schedule.recurs(5)), (): Result<never, Error> => {
          calls += 1;
          throw thrown;
        }, { sleeper })));

    expect(caught).toBe(thrown);
    expect(isPanic(caught)).toBe(false);
    expect(calls).toBe(1);
    expect(sleeper.millis).toEqual([]);
  });

  test("repeat inherits the same policy", async () => {
    const { platform, sleeper } = harness();
    let calls = 0;
    const caught = await rejection(() =>
      started(platform.layer, () =>
        Schedule.repeat(Schedule.spaced(Duration.millis(10)).and(Schedule.recurs(5)), (): Result<number, Panic> => {
          calls += 1;
          return calls < 3 ? success(calls) : failure(new Panic("stop"));
        }, { sleeper })));

    expect(isPanic(caught)).toBe(true);
    expect(calls).toBe(3);
    expect(sleeper.millis).toEqual([10, 10]);
  });
});

describe("Schedule.repeat", () => {
  test("repeats while successful and returns the last success", async () => {
    const { platform, sleeper } = harness();
    let calls = 0;
    const outcome = await started(platform.layer, () =>
      Schedule.repeat(Schedule.spaced(Duration.millis(25)).and(Schedule.recurs(2)), () => {
        calls += 1;
        return success(calls);
      }, { sleeper }));

    expect(calls).toBe(3);
    expect(sleeper.millis).toEqual([25, 25]);
    expect(outcome.unwrapOr(-1)).toBe(3);
  });

  test("the first failure ends the repetition and is returned unchanged", async () => {
    const { platform, sleeper } = harness();
    let calls = 0;
    const outcome = await started(platform.layer, () =>
      Schedule.repeat(Schedule.spaced(Duration.millis(25)).and(Schedule.recurs(10)), (): Result<number, Error> => {
        calls += 1;
        return calls < 3 ? success(calls) : failure(BOOM);
      }, { sleeper }));

    expect(calls).toBe(3);
    expect(sleeper.millis).toEqual([25, 25]);
    expect(errorOf(outcome)).toBe(BOOM);
  });
});

describe("Schedule sleeper resolution", () => {
  // These two used to merge their own Sleeper into `platform.layer`. The bundle
  // now carries one, and `Layer.merge` fails closed on a duplicate capability,
  // so the provided sleeper is read from the bundle instead. The assertions are
  // unchanged: what is provided is what drives the loop, and an explicit option
  // still outranks it.
  test("a Sleeper provided by the Layer is used with no option at all", async () => {
    const platform = TestPlatform.make();
    const counter = { calls: 0 };

    await started(platform.layer, () =>
      Schedule.retry(Schedule.spaced(Duration.millis(15)).and(Schedule.recurs(2)), alwaysFails(counter)));

    expect(platform.sleeper.millis).toEqual([15, 15]);
    expect(counter.calls).toBe(3);
  });

  test("an explicit sleeper outranks the one in the Layer", async () => {
    const platform = TestPlatform.make();
    const explicit = TestSleeper.make({ clock: platform.clock });
    const counter = { calls: 0 };

    await started(platform.layer, () =>
      Schedule.retry(Schedule.spaced(Duration.millis(15)).and(Schedule.recurs(2)), alwaysFails(counter), {
        sleeper: explicit,
      }));

    expect(explicit.millis).toEqual([15, 15]);
    expect(platform.sleeper.millis).toEqual([]);
    expect(panics(() => Schedule.retry(Schedule.recurs(0), () => success(1), { sleeper: {} as unknown as Sleeper })))
      .toBe(true);
  });

  test("an unprovided Sleeper fails closed instead of reaching the host timer", async () => {
    // The driver used to end in `catchPanic(() => Sleeper.context(), () =>
    // SystemSleeper.make())`, so a scope that provided a Clock but no Sleeper
    // silently slept on the ambient `globalThis.setTimeout` — including under
    // TestPlatform, whose TestClock reported frozen time throughout. A host
    // timer is a capability, so the unprovided case must panic.
    const clock = TestClock.at("2026-01-01T00:00:00.000Z");
    const counter = { calls: 0 };
    const original = globalThis.setTimeout;
    let ambient = 0;
    globalThis.setTimeout = ((callback: () => void, delay?: number): unknown => {
      ambient += 1;
      return (original as unknown as (cb: () => void, ms?: number) => unknown)(callback, delay);
    }) as unknown as typeof globalThis.setTimeout;

    let failure: unknown;
    try {
      await started(Layer.succeed(Clock, clock), () =>
        Schedule.retry(Schedule.spaced(Duration.millis(15)).and(Schedule.recurs(2)), alwaysFails(counter)));
    } catch (error) {
      failure = error;
    } finally {
      globalThis.setTimeout = original;
    }

    expect(isPanic(failure)).toBe(true);
    expect((failure as Panic).message).toContain("Sleeper");
    expect(ambient).toBe(0);
    // It failed before running the operation even once, not after sleeping.
    expect(counter.calls).toBe(0);
  });

  test("the deterministic bundle never reaches a host timer, and the live bundle does", async () => {
    // The positive direction of the check above, for both shipped bundles.
    const original = globalThis.setTimeout;
    let ambient = 0;
    globalThis.setTimeout = ((callback: () => void, delay?: number): unknown => {
      ambient += 1;
      return (original as unknown as (cb: () => void, ms?: number) => unknown)(callback, delay);
    }) as unknown as typeof globalThis.setTimeout;

    try {
      const platform = TestPlatform.make();
      const counter = { calls: 0 };
      await started(platform.layer, () =>
        Schedule.retry(Schedule.spaced(Duration.hours(1)).and(Schedule.recurs(2)), alwaysFails(counter)));
      expect(ambient).toBe(0);
      expect(platform.sleeper.millis).toEqual([3_600_000, 3_600_000]);
      expect(platform.clock.monotonic()).toBeGreaterThan(7_100_000);

      ambient = 0;
      const live = { calls: 0 };
      await started(nodePlatform({ clock: TestClock.at("2026-01-01T00:00:00.000Z") }), () =>
        Schedule.retry(Schedule.spaced(Duration.millis(1)).and(Schedule.recurs(2)), alwaysFails(live)));
      // The live bundle provides SystemSleeper, so it genuinely waits.
      expect(ambient).toBe(2);
      expect(live.calls).toBe(3);
    } finally {
      globalThis.setTimeout = original;
    }
  });

  test("no ambient timer is touched when a test sleeper drives the loop", async () => {
    const { platform, sleeper } = harness();
    const schedule = Schedule.exponential(Duration.hours(1)).jittered().and(Schedule.recurs(4));
    const counter = { calls: 0 };

    const original = globalThis.setTimeout;
    let ambient = 0;
    globalThis.setTimeout = ((callback: () => void, delay?: number): unknown => {
      ambient += 1;
      return (original as unknown as (cb: () => void, ms?: number) => unknown)(callback, delay);
    }) as unknown as typeof globalThis.setTimeout;

    try {
      await started(platform.layer, () => Schedule.retry(schedule, alwaysFails(counter), { sleeper }));
    } finally {
      globalThis.setTimeout = original;
    }

    // Four sleeps of roughly an hour each, and the test ran in microtasks.
    expect(ambient).toBe(0);
    expect(sleeper.millis.length).toBe(4);
    expect(counter.calls).toBe(5);
    expect(platform.clock.monotonic()).toBeGreaterThan(3_600_000);
  });
});

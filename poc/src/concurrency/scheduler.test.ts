import { expect, test } from "bun:test";
import { SystemClock, TestClock } from "../platform/clock.ts";
import { TestPlatform } from "../platform/layers.ts";
import { Layer } from "../runtime/layer.ts";
import { isPanic } from "../runtime/panic.ts";
import {
  assertFullyTicketed,
  type Completion,
  HostScheduler,
  ReplayScheduler,
  Scheduler,
  schedulerFor,
  testScheduler,
} from "./scheduler.ts";

const deferred = <T>() => {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};

const panicked = (body: () => unknown): unknown => {
  try {
    body();
  } catch (error) {
    if (isPanic(error)) return error;
    throw error;
  }
  throw new Error("expected a panic");
};

const panickedAsync = async (body: () => Promise<unknown>): Promise<unknown> => {
  try {
    await body();
  } catch (error) {
    if (isPanic(error)) return error;
    throw error;
  }
  throw new Error("expected a panic");
};

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

test("submission indices are assigned in program order", () => {
  const scheduler = ReplayScheduler.make();
  const first = scheduler.ticket("site-a");
  const second = scheduler.ticket("site-b");
  const third = scheduler.ticket("site-a");
  expect([first, second, third]).toEqual([
    { index: 0, site: "site-a" },
    { index: 1, site: "site-b" },
    { index: 2, site: "site-a" },
  ]);
  // Two submissions from the SAME site get different indices; the index is the
  // ordering fact, the site is the identity fact, and neither substitutes for
  // the other.
  expect(first.index).not.toBe(third.index);
});

test("a forged or malformed ticket is refused", () => {
  const scheduler = ReplayScheduler.make();
  panicked(() => scheduler.submit({ index: -1, site: "s" }, () => 1));
  panicked(() => scheduler.submit({ index: 1.5, site: "s" }, () => 1));
  panicked(() => scheduler.submit({ index: 0, site: "" }, () => 1));
  panicked(() => scheduler.ticket(""));
});

// ---------------------------------------------------------------------------
// THE COUNTER
// ---------------------------------------------------------------------------

test("a ticketed race leaves the counter at zero", async () => {
  const scheduler = ReplayScheduler.make();
  const slow = scheduler.submit(scheduler.ticket("slow"), () => new Promise((r) => setTimeout(() => r("slow"), 5)));
  const fast = scheduler.submit(scheduler.ticket("fast"), () => "fast");

  await expect(scheduler.firstReady([slow, fast])).resolves.toBe("fast");
  expect(scheduler.unticketed).toBe(0);
  expect(scheduler.audit.submissions).toBe(2);
  assertFullyTicketed(scheduler, { concurrency: "expected" });
});

test("THE DETECTOR: a bare-promise race — the naive Promise.race swap — moves the counter off zero", async () => {
  // This is the exact shape the migration plan's R6 warns about: `join.ts`'s
  // `Promise.race(contenders)` rewritten as `scheduler.firstReady(contenders)`
  // with the contenders left as raw promises. The VALUES are identical, so no
  // existing assertion anywhere in the tree can tell it apart from the correct
  // swap. This is what tells it apart.
  const scheduler = ReplayScheduler.make();
  const contenders = [Promise.resolve("first"), new Promise((r) => setTimeout(() => r("second"), 5))];

  await expect(scheduler.firstReady(contenders)).resolves.toBe("first");

  expect(scheduler.unticketed).toBe(2);
  expect(scheduler.audit.submissions).toBe(2);
  expect(scheduler.audit.unticketedSites).toEqual([
    "ReplayScheduler.firstReady",
    "ReplayScheduler.firstReady",
  ]);
  expect(() => assertFullyTicketed(scheduler, { concurrency: "expected" }))
    .toThrow(/2 of 2 concurrent submission\(s\) without a deterministic ticket/);
});

test("a partially ticketed race counts only the bare contenders", async () => {
  // The realistic half-migration: mapper tasks carry `token`, the cancellation
  // and source-pull promises beside them do not.
  const scheduler = ReplayScheduler.make();
  const mapped = scheduler.submit(scheduler.ticket("mapper#0"), () => new Promise((r) => setTimeout(() => r("mapped"), 5)));
  const cancellation = new Promise((r) => setTimeout(() => r("cancelled"), 10));

  await expect(scheduler.firstReady([mapped, cancellation])).resolves.toBe("mapped");
  expect(scheduler.audit).toEqual({
    submissions: 2,
    unticketed: 1,
    unticketedSites: ["ReplayScheduler.firstReady"],
  });
});

test("the counter accumulates across calls rather than reporting only the last one", async () => {
  const scheduler = ReplayScheduler.make();
  await scheduler.firstReady([Promise.resolve(1)]);
  await scheduler.firstReady([Promise.resolve(2)]);
  expect(scheduler.unticketed).toBe(2);
});

// ---------------------------------------------------------------------------
// The assertion, and its own fail-open
// ---------------------------------------------------------------------------

test("assertFullyTicketed refuses to pass vacuously when nothing was submitted", () => {
  // The plan has already shipped a harness guard that was itself a fail-open.
  // `expect(scheduler.unticketed).toBe(0)` is that guard: it passes on a
  // scheduler that saw nothing, which is every scheduler in the tree until the
  // combinators are routed through one. So a caller must say which case it is
  // asserting, and claiming "expected" over an idle scheduler is an error.
  const idle = ReplayScheduler.make();
  expect(idle.unticketed).toBe(0);
  expect(() => assertFullyTicketed(idle, { concurrency: "expected" }))
    .toThrow(/saw no concurrent submissions, so "unticketed === 0" proves nothing/);
  assertFullyTicketed(idle, { concurrency: "none" });
});

test("assertFullyTicketed refuses a `none` claim over a scheduler that did run", async () => {
  const scheduler = ReplayScheduler.make();
  await scheduler.firstReady([scheduler.submit(scheduler.ticket("s"), () => 1)]);
  expect(() => assertFullyTicketed(scheduler, { concurrency: "none" }))
    .toThrow(/declared to see no concurrency but saw 1 submission/);
});

test("assertFullyTicketed rejects a missing or malformed claim rather than assuming one", () => {
  const idle = ReplayScheduler.make();
  expect(() => assertFullyTicketed(idle, undefined as never)).toThrow(TypeError);
  expect(() => assertFullyTicketed(idle, { concurrency: "maybe" } as never)).toThrow(TypeError);
  expect(() => assertFullyTicketed(HostScheduler.make() as never, { concurrency: "none" })).toThrow(TypeError);
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

test("a recorded completion order is reproduced against the opposite arrival order", async () => {
  const recording = ReplayScheduler.make();
  const slowTicket = recording.ticket("slow");
  const fastTicket = recording.ticket("fast");
  const slow = recording.submit(slowTicket, () => new Promise((r) => setTimeout(() => r("slow"), 10)));
  const fast = recording.submit(fastTicket, () => "fast");
  await expect(recording.firstReady([slow, fast])).resolves.toBe("fast");

  const journal: readonly Completion[] = recording.completions;
  expect(journal).toEqual([{ index: 1, site: "fast" }]);

  // Replay with the arrival order INVERTED: what was fast is now slow. Arrival
  // order says "slow"; the journal says "fast"; the journal wins.
  const replay = ReplayScheduler.make({ journal });
  const a = replay.submit(replay.ticket("slow"), () => "slow");
  const b = replay.submit(replay.ticket("fast"), () => new Promise((r) => setTimeout(() => r("fast"), 10)));
  await expect(replay.firstReady([a, b])).resolves.toBe("fast");
  expect(replay.unticketed).toBe(0);
});

test("replay refuses rather than degrading when the body does not offer the journaled submission", async () => {
  const replay = ReplayScheduler.make({ journal: [{ index: 7, site: "gone" }] });
  const only = replay.submit(replay.ticket("present"), () => "present");
  const failure = await panickedAsync(() => replay.firstReady([only]));
  expect(String(failure)).toContain("diverged");
  expect(String(failure)).toContain("submission 7 at gone");
});

test("an unticketed contender can never satisfy a journal entry", async () => {
  // The counter says an unticketed submission happened; replay says it cannot
  // be the one the journal names. Both directions of the same fact.
  const replay = ReplayScheduler.make({ journal: [{ index: 0, site: "s" }] });
  await panickedAsync(() => replay.firstReady([Promise.resolve("bare")]));
  expect(replay.unticketed).toBe(1);
});

// ---------------------------------------------------------------------------
// allReady — the Promise.all tension, measured rather than settled
// ---------------------------------------------------------------------------

test("allReady answers in submission order regardless of completion order", async () => {
  const scheduler = ReplayScheduler.make();
  const slow = scheduler.submit(scheduler.ticket("slow"), () => new Promise((r) => setTimeout(() => r("slow"), 5)));
  const fast = scheduler.submit(scheduler.ticket("fast"), () => "fast");
  await expect(scheduler.allReady([slow, fast])).resolves.toEqual(["slow", "fast"]);
  expect(scheduler.unticketed).toBe(0);
});

test("allReady counts an unticketed submission exactly as firstReady does", async () => {
  // The position this lane takes and does NOT settle: the counter measures
  // DISPATCH, not the type row. `Promise.all` is order-independent, so it may
  // well charge no `Scheduler` requirement — but if concurrent work does reach
  // a scheduler through this method, it is counted here on the same terms as
  // arrival-order work. The consequence, stated plainly: if `Promise.all` stays
  // free of the `Scheduler` requirement, its submissions never reach this
  // method and the counter is BLIND to them. The hole is exactly the size of
  // the tension.
  const scheduler = ReplayScheduler.make();
  await scheduler.allReady([Promise.resolve(1), Promise.resolve(2)]);
  expect(scheduler.unticketed).toBe(2);
  expect(scheduler.audit.unticketedSites).toEqual([
    "ReplayScheduler.allReady",
    "ReplayScheduler.allReady",
  ]);
});

test("allReady applies no journal check, because its answer does not depend on arrival order", async () => {
  // Deliberate asymmetry with firstReady: a journal entry naming a submission
  // this call did not make is a divergence for `firstReady` and is not one
  // here, because nothing observable depends on the order.
  const scheduler = ReplayScheduler.make({ journal: [{ index: 99, site: "absent" }] });
  const a = scheduler.submit(scheduler.ticket("a"), () => "a");
  const b = scheduler.submit(scheduler.ticket("b"), () => "b");
  await expect(scheduler.allReady([a, b])).resolves.toEqual(["a", "b"]);
});

// ---------------------------------------------------------------------------
// No ambient fallback
// ---------------------------------------------------------------------------

test("an unprovided Scheduler fails closed rather than degrading to Promise.race", () => {
  // `platform/schedule.ts` records what the alternative costs: `Sleeper` used
  // to swallow this panic and hand back `globalThis.setTimeout`, so retries
  // slept on a host timer under the deterministic bundle. A scheduler that
  // degraded to arrival order would be the same defect, one layer up.
  panicked(() => schedulerFor(undefined, "test"));
});

test("an explicit non-Scheduler is refused", () => {
  panicked(() => schedulerFor({ firstReady: () => Promise.resolve(1) } as never, "test"));
});

test("a provided Scheduler is resolved through the Layer", () => {
  const provided = ReplayScheduler.make();
  const resolved = Layer.provide(Layer.succeed(Scheduler, provided), () => schedulerFor(undefined, "test"));
  expect(resolved).toBe(provided);
});

// ---------------------------------------------------------------------------
// Bound to the deterministic clock
// ---------------------------------------------------------------------------

test("the deterministic scheduler refuses a live clock instead of ignoring it", () => {
  panicked(() => ReplayScheduler.make({ clock: SystemClock.make() as never }));
  panicked(() => ReplayScheduler.make({ journal: "not an array" as never }));
});

test("completions are stamped from the bound TestClock and no real time passes", async () => {
  const clock = TestClock.at("2026-01-01T00:00:00.000Z");
  const scheduler = ReplayScheduler.make({ clock });
  await scheduler.firstReady([scheduler.submit(scheduler.ticket("a"), () => "a")]);
  clock.advance(500);
  await scheduler.firstReady([scheduler.submit(scheduler.ticket("b"), () => "b")]);
  expect(scheduler.completions).toEqual([
    { index: 0, site: "a", at: 0 },
    { index: 1, site: "b", at: 500 },
  ]);
});

// ---------------------------------------------------------------------------
// The TestPlatform surface
// ---------------------------------------------------------------------------

test("testScheduler binds to a TestPlatform bundle's clock and refuses a live bundle", () => {
  const platform = TestPlatform.make();
  const scheduler = testScheduler(platform);
  platform.clock.advance(42);
  expect(scheduler).toBeInstanceOf(ReplayScheduler);
  panicked(() => testScheduler({ clock: SystemClock.make() }));
});

test("a TestPlatform-based run that dispatches through the scheduler is fully ticketed", async () => {
  // The assertion R6 asks for, in the shape it will take once the combinators
  // are routed through a scheduler: build the deterministic bundle, run
  // concurrent work through the scheduler bound to it, and require that every
  // submission carried an index.
  const platform = TestPlatform.make();
  const scheduler = testScheduler(platform);

  const gate = deferred<string>();
  const held = scheduler.submit(scheduler.ticket("held"), () => gate.promise);
  const ready = scheduler.submit(scheduler.ticket("ready"), () => "ready");

  await expect(scheduler.firstReady([held, ready])).resolves.toBe("ready");
  gate.settle("held");
  await expect(scheduler.allReady([held])).resolves.toEqual(["held"]);

  assertFullyTicketed(scheduler, { concurrency: "expected" }, "TestPlatform scheduler");
  expect(scheduler.completions.map((completion) => completion.site)).toEqual(["ready", "held"]);
  // The deterministic bundle's clock did not move, so nothing in the run
  // depended on real time.
  expect(platform.clock.monotonic()).toBe(0);
});

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

test("the live scheduler is arrival-ordered and carries no counter", async () => {
  const host = HostScheduler.make();
  const slow = host.submit(host.ticket("slow"), () => new Promise((r) => setTimeout(() => r("slow"), 5)));
  const fast = host.submit(host.ticket("fast"), () => "fast");
  await expect(host.firstReady([slow, fast])).resolves.toBe("fast");
  await expect(host.allReady([slow, fast])).resolves.toEqual(["slow", "fast"]);
  expect("unticketed" in host).toBe(false);
});

test("an empty race is refused by both implementations", async () => {
  await panickedAsync(() => ReplayScheduler.make().firstReady([]));
  await panickedAsync(async () => HostScheduler.make().firstReady([]));
  // An empty `all`, unlike an empty race, has an answer.
  await expect(ReplayScheduler.make().allReady([])).resolves.toEqual([]);
});

test("a non-iterable contender set is refused", async () => {
  await panickedAsync(() => ReplayScheduler.make().firstReady(42 as never));
  await panickedAsync(() => ReplayScheduler.make().firstReady([null] as never));
});

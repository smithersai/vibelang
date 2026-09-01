import { expect, test } from "bun:test";
import { SystemClock, TestClock } from "../platform/clock.ts";
import { TestPlatform } from "../platform/layers.ts";
import { Layer } from "../runtime/layer.ts";
import { isPanic } from "../runtime/panic.ts";
import { __vsInspectResult } from "../runtime/result.ts";
import { Cancellation } from "./join.ts";
import { bufferedUnordered } from "./async-iterators.ts";
import { Stream } from "./stream.ts";
import { mapUnordered } from "./join.ts";
import {
  assertFullyTicketed,
  HostScheduler,
  type JournalRow,
  ReplayScheduler,
  Scheduler,
  schedulerFor,
  schedulerIfProvided,
  testScheduler,
} from "./scheduler.ts";

const deferred = <T>() => {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};

/**
 * Settle after `ticks` microtask turns. Arrival order without timers: fewest
 * ticks wins, deterministically, so a "which finished first" test is a fact
 * rather than a race the CI machine gets to vote on.
 */
const afterTicks = async <T>(ticks: number, value: T): Promise<T> => {
  for (let turn = 0; turn < ticks; turn += 1) await Promise.resolve();
  return value;
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

test("a single firstReady round-trips its own journal against the opposite arrival order", async () => {
  // Named for exactly what it covers. It used to be called "a recorded
  // completion order is reproduced", which is a claim about journals in
  // general; this program contains one firstReady and no allReady, and the
  // general claim was false — see the mixed-program round trip below.
  const recording = ReplayScheduler.make();
  const slowTicket = recording.ticket("slow");
  const fastTicket = recording.ticket("fast");
  const slow = recording.submit(slowTicket, () => new Promise((r) => setTimeout(() => r("slow"), 10)));
  const fast = recording.submit(fastTicket, () => "fast");
  await expect(recording.firstReady([slow, fast])).resolves.toBe("fast");

  const journal: readonly JournalRow[] = recording.journal;
  expect(journal).toEqual([{
    op: "firstReady",
    site: "firstReady",
    occurrence: 0,
    offered: [{ index: 0, site: "slow" }, { index: 1, site: "fast" }],
    winner: { index: 1, site: "fast" },
  }]);

  // Replay with the arrival order INVERTED: what was fast is now slow. Arrival
  // order says "slow"; the journal says "fast"; the journal wins.
  const replay = ReplayScheduler.make({ journal });
  const a = replay.submit(replay.ticket("slow"), () => "slow");
  const b = replay.submit(replay.ticket("fast"), () => new Promise((r) => setTimeout(() => r("fast"), 10)));
  await expect(replay.firstReady([a, b])).resolves.toBe("fast");
  expect(replay.unticketed).toBe(0);
  expect(replay.replay).toEqual({ rows: 1, replayed: 1, dispatchedLive: 0 });
});

test("replay refuses rather than degrading when the body does not offer the journaled submission", async () => {
  const replay = ReplayScheduler.make({
    journal: [{
      op: "firstReady",
      site: "firstReady",
      occurrence: 0,
      offered: [{ index: 7, site: "gone" }],
      winner: { index: 7, site: "gone" },
    }],
  });
  const only = replay.submit(replay.ticket("present"), () => "present");
  const failure = await panickedAsync(() => replay.firstReady([only]));
  expect(String(failure)).toContain("diverged");
  expect(String(failure)).toContain("[7@gone]");
  expect(String(failure)).toContain("[0@present]");
});

test("an unticketed contender can never satisfy a journal entry", async () => {
  // The counter says an unticketed submission happened; replay says it cannot
  // be the one the journal names. Both directions of the same fact.
  const replay = ReplayScheduler.make({
    journal: [{
      op: "firstReady",
      site: "firstReady",
      occurrence: 0,
      offered: [{ index: 0, site: "s" }],
      winner: { index: 0, site: "s" },
    }],
  });
  await panickedAsync(() => replay.firstReady([Promise.resolve("bare")]));
  expect(replay.unticketed).toBe(1);
});

test("a journal whose firstReady winner was unticketed is refused rather than approximated", async () => {
  // The recorded run answered with a bare promise, so the row names `-1`, which
  // identifies no submission any run can offer. Refusing is the only honest
  // answer; picking "the contender at that position" would invent an identity.
  const recording = ReplayScheduler.make();
  await recording.firstReady([Promise.resolve("bare")]);
  expect(recording.journal[0]!.winner).toEqual({ index: -1, site: "<unticketed>" });

  // Even when the body offers the identical unticketed contender — so the
  // offered set matches — the row cannot be replayed: `-1` names no submission.
  const replay = ReplayScheduler.make({ journal: recording.journal });
  const failure = await panickedAsync(() => replay.firstReady([Promise.resolve("bare")]));
  expect(String(failure)).toContain("unticketed submission, which no run can reproduce");
  expect(replay.unticketed).toBe(1);
});

test("a malformed or untagged journal row is refused at construction", () => {
  // The old row shape — a bare `{ index, site }` — is exactly the shape that
  // could not say which operation recorded it. It is now unconstructable.
  panicked(() => ReplayScheduler.make({ journal: [{ index: 0, site: "s" } as never] }));
  panicked(() =>
    ReplayScheduler.make({
      journal: [{ op: "firstReady", site: "s", occurrence: 0, offered: [{ index: 0, site: "a" }] }],
    })
  );
  panicked(() =>
    ReplayScheduler.make({
      journal: [{
        op: "allReady",
        site: "s",
        occurrence: 0,
        offered: [],
        winner: { index: 0, site: "a" },
      }],
    })
  );
  // Two rows keyed to the same (site, occurrence) is an incoherent journal.
  const row: JournalRow = { op: "allReady", site: "s", occurrence: 0, offered: [] };
  panicked(() => ReplayScheduler.make({ journal: [row, row] }));
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

test("allReady pins no arrival order, and records none, because it observes none", async () => {
  // Renamed from "allReady applies no journal check". That name overstated the
  // asymmetry into "no check at all", and the implementation obliged: allReady
  // wrote rows into the same stream the firstReady cursor consumed, so a
  // program mixing the two could not replay its own recording. allReady still
  // applies NO ORDERING check — its answer is order-independent — but its row
  // is tagged and its offered set is verified.
  const recording = ReplayScheduler.make();
  const slow = recording.submit(recording.ticket("slow"), () => afterTicks(6, "slow"));
  const fast = recording.submit(recording.ticket("fast"), () => afterTicks(1, "fast"));
  await expect(recording.allReady([slow, fast])).resolves.toEqual(["slow", "fast"]);

  // `fast` genuinely settled first, and the row does not claim otherwise: it
  // records the submissions offered, in submission order, and no winner. The
  // previous shape recorded a "completion order" that was sorted back into
  // submission order before being written, so it reported submission order
  // whatever happened — a tautology wearing the name of an observation.
  expect(recording.journal).toEqual([{
    op: "allReady",
    site: "allReady",
    occurrence: 0,
    offered: [{ index: 0, site: "slow" }, { index: 1, site: "fast" }],
  }]);
  expect(recording.journal[0]).not.toHaveProperty("winner");

  // Replaying with the arrival order inverted is not a divergence, because
  // nothing observable depended on it.
  const replay = ReplayScheduler.make({ journal: recording.journal });
  const a = replay.submit(replay.ticket("slow"), () => afterTicks(1, "slow"));
  const b = replay.submit(replay.ticket("fast"), () => afterTicks(6, "fast"));
  await expect(replay.allReady([a, b])).resolves.toEqual(["slow", "fast"]);
  expect(replay.replay).toEqual({ rows: 1, replayed: 1, dispatchedLive: 0 });
});

test("allReady diverges when the body offers a different submission set than the journal records", async () => {
  // The one thing an order-independent operation DOES have worth journaling —
  // `durable-execution.mdx` §Divergence asks for exactly this.
  const recording = ReplayScheduler.make();
  const a = recording.submit(recording.ticket("a"), () => "a");
  const b = recording.submit(recording.ticket("b"), () => "b");
  await recording.allReady([a, b]);

  const replay = ReplayScheduler.make({ journal: recording.journal });
  const only = replay.submit(replay.ticket("a"), () => "a");
  const failure = await panickedAsync(() => replay.allReady([only]));
  expect(String(failure)).toContain("diverged at allReady occurrence 0");
  expect(String(failure)).toContain("[0@a, 1@b]");
});

test("a row records which operation wrote it, so the other operation cannot consume it", async () => {
  // The mechanism the mixed-program defect was missing: an untagged row is
  // readable as either operation, and the cursor read every one of them as a
  // firstReady expectation.
  const recording = ReplayScheduler.make();
  await recording.allReady([recording.submit(recording.ticket("a"), () => "a")], "shared-site");

  const replay = ReplayScheduler.make({ journal: recording.journal });
  const failure = await panickedAsync(() =>
    replay.firstReady([replay.submit(replay.ticket("a"), () => "a")], "shared-site")
  );
  expect(String(failure)).toContain("diverged at shared-site occurrence 0");
  expect(String(failure)).toContain("the journal records allReady there, not firstReady");
});

// ---------------------------------------------------------------------------
// THE ROUND TRIP: a journal must replay against the program that recorded it
// ---------------------------------------------------------------------------

/**
 * One step of a generated program: an operation, and the microtask delay of
 * each of its submissions. `firstReady`'s answer depends on those delays;
 * `allReady`'s does not, which is the whole asymmetry under test.
 */
interface Step {
  readonly op: "firstReady" | "allReady";
  readonly delays: readonly number[];
}

/** Run `program` on `scheduler`, returning every value it produced. */
async function runProgram(scheduler: ReplayScheduler, program: readonly Step[], invert: boolean): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const [at, step] of program.entries()) {
    const longest = Math.max(...step.delays, 0);
    const contenders = step.delays.map((delay, position) =>
      scheduler.submit(
        scheduler.ticket(`s${at}-${position}`),
        // Inverting the delays flips arrival order without touching program
        // order, which is exactly the condition replay must be immune to.
        () => afterTicks(invert ? longest - delay + 1 : delay, `v${at}-${position}`),
      )
    );
    results.push(
      step.op === "firstReady"
        ? await scheduler.firstReady(contenders)
        : await scheduler.allReady(contenders),
    );
  }
  return results;
}

/**
 * A program generated from `seed`, so a failing case is reproducible from the
 * seed the failure reports.
 *
 * mulberry32 rather than a hand-rolled LCG: an LCG's low bits have a period of
 * two, so `state % 2` — the coin flip that decides `firstReady` vs `allReady` —
 * comes out constant, and the generator silently produces no mixed programs at
 * all. That is the same class of defect as the one under test: a check that
 * cannot fail is not a check, and it looks green either way.
 */
function programFor(seed: number): Step[] {
  let state = seed >>> 0;
  const next = (bound: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * bound);
  };
  return Array.from({ length: 1 + next(4) }, () => ({
    op: next(2) === 0 ? "firstReady" as const : "allReady" as const,
    delays: Array.from({ length: 1 + next(3) }, () => 1 + next(6)),
  }));
}

/** Programs that actually mix the two operations — the case that was untested. */
function mixedPrograms(count: number): { readonly seed: number; readonly program: Step[] }[] {
  const out: { seed: number; program: Step[] }[] = [];
  for (let seed = 0; out.length < count; seed += 1) {
    const program = programFor(seed);
    if (program.some((step) => step.op === "firstReady") && program.some((step) => step.op === "allReady")) {
      out.push({ seed, program });
    }
  }
  return out;
}

test("PROPERTY: any mixed program replays the journal it just recorded, under inverted arrival order", async () => {
  // The test that was missing. `scheduler.journal` is documented as the value
  // `make({ journal })` consumes, and both halves were individually tested —
  // "a single firstReady round-trips its own journal" above, and the allReady
  // arm's own test above this block — but nothing composed them. Composed, they
  // were incoherent: allReady rows were read as firstReady expectations and
  // poisoned replay of any program that used both.
  //
  // Stated as a property rather than as the single case that exposed it, so a
  // fix that satisfies one interleaving cannot pass while the class stays
  // broken.
  const cases = mixedPrograms(40);
  expect(cases.length).toBe(40);
  for (const { seed, program } of cases) {
    const recording = ReplayScheduler.make();
    const recorded = await runProgram(recording, program, false);
    const journal = recording.journal;
    expect(recording.replay).toEqual({ rows: 0, replayed: 0, dispatchedLive: 0 });

    const replay = ReplayScheduler.make({ journal });
    const replayed = await runProgram(replay, program, true);

    expect({ seed, replayed }).toEqual({ seed, replayed: recorded });
    expect(replay.journal).toEqual(journal);
    // A journal recorded from a COMPLETE run is total for its own program, so
    // replay never reaches the live-dispatch path. This is the third half of
    // the same question: exhaustion is a legitimate resumption boundary, and a
    // full round trip must never hit it.
    expect({ seed, ...replay.replay }).toEqual({ seed, rows: journal.length, replayed: journal.length, dispatchedLive: 0 });
    expect(replay.unticketed).toBe(0);
  }
});

test("the reviewer's case: allReady of two, then firstReady of two, second submission first", async () => {
  // The concrete interleaving the property generalizes, kept because a named
  // regression is easier to read than a seed.
  //
  // Under the old shape this program recorded three rows — the allReady's two
  // submissions in SUBMISSION order (though the second one settled first, which
  // the rows could not say), then the firstReady's winner — and replaying those
  // three rows against this same body panicked with "the journal expects
  // submission 0 at s0-0, which this run did not offer", because the firstReady
  // cursor consumed the allReady's first row.
  const program: readonly Step[] = [
    { op: "allReady", delays: [6, 1] },
    { op: "firstReady", delays: [6, 1] },
  ];
  const recording = ReplayScheduler.make();
  const recorded = await runProgram(recording, program, false);
  expect(recorded).toEqual([["v0-0", "v0-1"], "v1-1"]);

  const replay = ReplayScheduler.make({ journal: recording.journal });
  await expect(runProgram(replay, program, true)).resolves.toEqual(recorded);
});

// ---------------------------------------------------------------------------
// Exhaustion: a legitimate boundary, made observable
// ---------------------------------------------------------------------------

test("a journal that does not cover an operation dispatches it live AND says so", async () => {
  // `durable-execution.mdx` §Replay: "the first request with no journal entry
  // MUST be dispatched" — that is how a resumed execution gets past its
  // recorded prefix, so this is policy, not a defect. The defect was that it
  // happened SILENTLY: a run whose journal ran out was indistinguishable from a
  // run given no journal at all, in a class whose stated posture is "refuses
  // rather than degrades".
  const recording = ReplayScheduler.make();
  const a = recording.submit(recording.ticket("a"), () => afterTicks(6, "a"));
  const b = recording.submit(recording.ticket("b"), () => afterTicks(1, "b"));
  await recording.firstReady([a, b]);
  const prefix = recording.journal;

  const replay = ReplayScheduler.make({ journal: prefix });
  const c = replay.submit(replay.ticket("a"), () => afterTicks(1, "a"));
  const d = replay.submit(replay.ticket("b"), () => afterTicks(6, "b"));
  await expect(replay.firstReady([c, d])).resolves.toBe("b"); // journaled: slow "b" still wins

  const e = replay.submit(replay.ticket("c"), () => afterTicks(1, "c"));
  const f = replay.submit(replay.ticket("d"), () => afterTicks(6, "d"));
  await expect(replay.firstReady([e, f])).resolves.toBe("c"); // unjournaled: dispatched live

  expect(replay.replay).toEqual({ rows: 1, replayed: 1, dispatchedLive: 1 });
  expect(replay.dispatchedLive).toBe(1);
  // And the run's own journal is the replayed prefix plus the new row, ready to
  // be the journal of the next resumption.
  expect(replay.journal.length).toBe(2);
  expect(replay.journal[0]).toEqual(prefix[0]!);
});

test("a missing row is distinguished from a misaligned one, which a positional cursor could not do", async () => {
  // The keyed lookup `durable-execution.mdx` §Journal Identity mandates:
  // occurrence 1 is journaled and occurrence 0 is not, which a stream read
  // positionally reports as "row 0 expects the occurrence-1 submissions".
  const journal: readonly JournalRow[] = [{
    op: "firstReady",
    site: "firstReady",
    occurrence: 1,
    offered: [{ index: 2, site: "c" }, { index: 3, site: "d" }],
    winner: { index: 3, site: "d" },
  }];
  const replay = ReplayScheduler.make({ journal });
  const a = replay.submit(replay.ticket("a"), () => afterTicks(1, "a"));
  const b = replay.submit(replay.ticket("b"), () => afterTicks(6, "b"));
  await expect(replay.firstReady([a, b])).resolves.toBe("a"); // no row: dispatched live

  const c = replay.submit(replay.ticket("c"), () => afterTicks(1, "c"));
  const d = replay.submit(replay.ticket("d"), () => afterTicks(6, "d"));
  await expect(replay.firstReady([c, d])).resolves.toBe("d"); // row found by key
  expect(replay.replay).toEqual({ rows: 1, replayed: 1, dispatchedLive: 1 });
});

test("occurrence indices are counted per site, so an interleaved site does not shift another's rows", async () => {
  // §Journal Identity keys a row by `(siteIdentity, occurrenceIndex)`, not by
  // position in a stream. Here `left` is called twice with `right` interleaved
  // between them: keyed lookup gives `left`'s second call `left#1`, whereas a
  // positional cursor would have handed it the row `right` wrote.
  const body = async (scheduler: ReplayScheduler, invert: boolean) => {
    const results: unknown[] = [];
    for (const [at, site] of ["left", "right", "left"].entries()) {
      const slow = scheduler.submit(scheduler.ticket(`s${at}`), () => afterTicks(invert ? 1 : 6, `s${at}`));
      const fast = scheduler.submit(scheduler.ticket(`f${at}`), () => afterTicks(invert ? 6 : 1, `f${at}`));
      results.push(await scheduler.firstReady([slow, fast], site));
    }
    return results;
  };

  const recording = ReplayScheduler.make();
  const recorded = await body(recording, false);
  expect(recording.journal.map((row) => `${row.site}#${row.occurrence}`)).toEqual(["left#0", "right#0", "left#1"]);

  const replay = ReplayScheduler.make({ journal: recording.journal });
  await expect(body(replay, true)).resolves.toEqual(recorded);
  expect(replay.replay).toEqual({ rows: 3, replayed: 3, dispatchedLive: 0 });
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

test("journal rows are stamped from the bound TestClock and no real time passes", async () => {
  const clock = TestClock.at("2026-01-01T00:00:00.000Z");
  const scheduler = ReplayScheduler.make({ clock });
  await scheduler.firstReady([scheduler.submit(scheduler.ticket("a"), () => "a")]);
  clock.advance(500);
  await scheduler.firstReady([scheduler.submit(scheduler.ticket("b"), () => "b")]);
  expect(scheduler.journal).toEqual([
    {
      op: "firstReady",
      site: "firstReady",
      occurrence: 0,
      offered: [{ index: 0, site: "a" }],
      winner: { index: 0, site: "a" },
      at: 0,
    },
    {
      op: "firstReady",
      site: "firstReady",
      occurrence: 1,
      offered: [{ index: 1, site: "b" }],
      winner: { index: 1, site: "b" },
      at: 500,
    },
  ]);
  // `at` is evidence, not identity: a journal replays whatever the clock read.
  const replay = ReplayScheduler.make({ journal: scheduler.journal });
  await replay.firstReady([replay.submit(replay.ticket("a"), () => "a")]);
  await replay.firstReady([replay.submit(replay.ticket("b"), () => "b")]);
  expect(replay.replay).toEqual({ rows: 2, replayed: 2, dispatchedLive: 0 });
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
  expect(scheduler.journal.map((row) => `${row.op}#${row.occurrence}`)).toEqual(["firstReady#0", "allReady#0"]);
  expect(scheduler.journal[0]!.winner).toEqual({ index: 1, site: "ready" });
  // The allReady row carries no winner, because it observed no arrival order.
  expect(scheduler.journal[1]!.winner).toBeUndefined();
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

// ---------------------------------------------------------------------------
// R6: the counter, read over the combinators that were routed onto it
//
// Everything above tests the scheduler against contenders a test handed it
// directly. These tests are the ones the migration step is actually worth:
// they run the real combinators under a real `TestPlatform` and read
// `unticketed` afterwards. A swap that kept arrival-order semantics — every
// `Promise.race` renamed to `firstReady` while the callers still handed over
// bare promises — produces identical output and passes every OTHER assertion in
// this repository. It fails here and nowhere else.
// ---------------------------------------------------------------------------

/**
 * Assert full ticketing AND prove the counter that says so was live.
 *
 * `expect(scheduler.unticketed).toBe(0)` is a fail-open twice over: a scheduler
 * nothing reached reads zero, and so does a scheduler whose counter is simply
 * never incremented. `assertFullyTicketed(..., { concurrency: "expected" })`
 * closes the first hole by refusing a zero over an idle scheduler. This closes
 * the second, on the very instance the run used: after the assertion passes,
 * hand that same scheduler a bare promise and watch the counter move. A counter
 * that cannot move reads zero exactly like a correctly-ticketed run.
 */
async function ticketedThroughout(scheduler: ReplayScheduler, label: string): Promise<void> {
  const before = scheduler.audit;
  expect(before.submissions).toBeGreaterThan(0);
  assertFullyTicketed(scheduler, { concurrency: "expected" }, label);

  await scheduler.firstReady([Promise.resolve("bare")], `${label}.counterProbe`);
  expect(scheduler.audit.unticketed).toBe(before.unticketed + 1);
  expect(scheduler.audit.unticketedSites).toContain("ReplayScheduler.firstReady");
}

test("mapUnordered routes every arm through the scheduler with a ticket", async () => {
  const platform = TestPlatform.make();
  const cancellation = new Cancellation();
  const layer = Layer.merge(platform.layer, Layer.succeed(Cancellation, cancellation));

  const mapped = Layer.provide(layer, () =>
    mapUnordered([1, 2, 3, 4], async (value) => value * 2, { concurrency: 2 }));
  const collected: number[] = [];
  for await (const value of mapped) collected.push(value);

  expect(collected.slice().sort((left, right) => left - right)).toEqual([2, 4, 6, 8]);
  await ticketedThroughout(platform.scheduler, "mapUnordered");
});

test("bufferedUnordered routes every arm through the scheduler with a ticket", async () => {
  const platform = TestPlatform.make();
  const cancellation = new Cancellation();
  const layer = Layer.merge(platform.layer, Layer.succeed(Cancellation, cancellation));

  const buffered = Layer.provide(layer, () => bufferedUnordered([1, 2, 3, 4], { concurrency: 2 }));
  const collected: number[] = [];
  for await (const value of buffered) collected.push(value);

  expect(collected.slice().sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
  await ticketedThroughout(platform.scheduler, "bufferedUnordered");
});

test("Stream.buffer's hand-rolled pull race routes through the scheduler with a ticket", async () => {
  const platform = TestPlatform.make();
  // Not a `Promise.race` in the source, which is exactly why it is asserted
  // separately: a grep-driven migration would have left this one behind and
  // every other test in the tree would still have passed.
  const stream = Layer.provide(platform.layer, () => Stream.fromIterable([1, 2, 3]).buffer(2));
  const collected = __vsInspectResult(await stream.runCollect());

  expect(collected.ok).toBe(true);
  if (collected.ok) expect(collected.value).toEqual([1, 2, 3]);
  await ticketedThroughout(platform.scheduler, "Stream.buffer");
});

test("an unprovided Scheduler is refused rather than degraded to arrival order", () => {
  // The final state of the migration. While the routing was landing this call
  // ran fine without a scheduler, on a `Promise.race` fallback; that fallback
  // is deleted, because a degradation to arrival order has no observable
  // symptom and so cannot be found once it exists.
  const cancellation = new Cancellation();
  expect(() =>
    Layer.provide(Layer.succeed(Cancellation, cancellation), () =>
      mapUnordered([1, 2], async (value) => value + 1, { concurrency: 2 }))
  ).toThrow(/capability 'Scheduler' was not provided/);
});

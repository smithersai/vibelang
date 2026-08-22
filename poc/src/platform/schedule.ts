/**
 * `Schedule`: a pure description of *when* to try again, plus the two drivers
 * that run something under one.
 *
 * **Status: provisional.** `Schedule` is listed in
 * docs/src/pages/reference/standard-library.mdx under "Configuration and Time"
 * but has no written specification yet; the names and semantics below are this
 * POC's proposal, not a settled surface.
 *
 * The split that runs through `Config` and `Duration` runs through here too:
 * *describing* a retry policy is pure, and only *running* one touches a
 * capability. `Schedule.exponential(Duration.millis(100)).withMaxDelay(...)`
 * builds a frozen, non-forgeable value anywhere — at module scope, in a config
 * record, in a comptime constant. `Schedule.retry` is what resolves `Clock`
 * (to observe elapsed time), a `Sleeper` (to wait), and — only when the policy
 * actually jitters — `Random`.
 *
 * A schedule is data plus a pure `step`:
 *
 *     schedule.step(state, { attempt, elapsed })
 *       -> { continue, delay, jitter, maxDelay, state }
 *
 * `step` is deterministic given its inputs. It never reads a clock and never
 * draws a random number: jitter is *described* by the returned `jitter` band and
 * is only applied by a driver, which draws through `Random.context()`. That is
 * what makes the whole policy layer testable without any capability at all
 * (see `.preview()`), and what keeps `Random` out of a schedule's construction
 * requirements.
 *
 * No Effect-style wrapper ceremony (docs/DECISIONS.md, "Standard library"): a
 * schedule is an ordinary value, an operation is an ordinary function returning
 * `Result`, and a driver is an ordinary `async` function returning the same
 * `Result` the operation produces.
 *
 * **Not a durable policy.** These values are deliberately *not* registered with
 * a wire codec and are not durable values: the durable subsystem persists its
 * own retry deadlines and backoff in node state (poc/src/durable), and conflating
 * the two would let an in-process policy object masquerade as a replay-stable
 * one across a coordinator restart.
 */

import { Context } from "../runtime/layer.ts";
import { type Panic, catchPanic, panic } from "../runtime/panic.ts";
import { type Result, isResult, rethrowPanics } from "../runtime/result.ts";
import { Clock, TestClock } from "./clock.ts";
// One binding, two meanings — the `Duration` type and its namespace, exactly as
// ./config.ts imports it.
import { Duration, MAX_DURATION_MILLIS, durationFromMillis } from "./duration.ts";
import { Random } from "./random.ts";

// ---------------------------------------------------------------------------
// Sleeping
// ---------------------------------------------------------------------------

/**
 * Waiting. Reading time is `Clock`'s job; *pausing* is a separate host facility
 * and gets its own capability.
 *
 * Why not a member of `Clock`: `Clock` already has three live implementations
 * and a documented contract of pure *observation* — adding an abstract `sleep`
 * would break every existing implementation and would make a read-only clock
 * double suddenly responsible for scheduling work. Why *optional* rather than a
 * required member of the platform bundle: no existing `PlatformLayer` provides
 * a `Sleeper`, so requiring one would break every already written
 * `Layer.provide`. A driver therefore resolves, in order:
 *
 *   1. an explicit `options.sleeper`,
 *   2. a `Sleeper` provided by the enclosing Layer,
 *   3. `SystemSleeper` over the host timer.
 *
 * Step 3 is the compromise, and it is deliberately the *last* one: it keeps
 * `Schedule.retry` usable from plain TypeScript, and a test that must prove no
 * host timer was touched simply provides a `TestSleeper` and asserts on the
 * ambient `setTimeout` spy. When `layers.ts` can carry a seventh service,
 * `Sleeper` should join the bundle and step 3 should be deleted.
 */
export abstract class Sleeper extends Context {
  /** Resolves after (at least) `duration`. A zero duration still yields. */
  abstract sleep(duration: Duration): Promise<void>;
}

/** The one host function `SystemSleeper` depends on; injectable for tests. */
export type TimerLike = (callback: () => void, millis: number) => unknown;

export interface SystemSleeperOptions {
  readonly timer?: TimerLike;
}

function sleepMillis(duration: Duration, caller: string): number {
  if (!Duration.isDuration(duration)) panic(`${caller} requires a Duration`);
  const millis = duration.toMillis();
  if (millis < 0) panic(`${caller} cannot sleep for a negative duration`);
  return millis;
}

/** Live implementation over the host timer. */
export class SystemSleeper extends Sleeper {
  readonly #timer: TimerLike | undefined;

  private constructor(timer: TimerLike | undefined) {
    super();
    this.#timer = timer;
  }

  static make(options: SystemSleeperOptions = {}): SystemSleeper {
    if (options.timer !== undefined && typeof options.timer !== "function") {
      panic("SystemSleeper.make timer option must be a function");
    }
    return new SystemSleeper(options.timer);
  }

  sleep(duration: Duration): Promise<void> {
    const millis = sleepMillis(duration, "SystemSleeper.sleep");
    // Read the ambient timer at call time, not at construction: that is what
    // lets a test spy on `globalThis.setTimeout` observe this path at all.
    const timer: TimerLike = this.#timer ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    return new Promise<void>((resolve) => {
      timer(() => resolve(), millis);
    });
  }
}

export interface TestSleeperOptions {
  /** When given, each sleep advances this clock instead of waiting. */
  readonly clock?: TestClock;
}

/**
 * Deterministic sleeper. It never touches a host timer: it records the duration
 * and, if a `TestClock` was supplied, advances it — so a schedule that reads
 * elapsed time (`fixed`, `upTo`) behaves exactly as it would in real time while
 * the test runs at full speed.
 */
export class TestSleeper extends Sleeper {
  readonly #recorded: Duration[] = [];
  readonly #clock: TestClock | undefined;

  private constructor(clock: TestClock | undefined) {
    super();
    this.#clock = clock;
  }

  static make(options: TestSleeperOptions = {}): TestSleeper {
    if (options.clock !== undefined && !(options.clock instanceof TestClock)) {
      panic("TestSleeper.make clock option must be a TestClock");
    }
    return new TestSleeper(options.clock);
  }

  /** Every duration slept, in order. */
  get sleeps(): readonly Duration[] {
    return Object.freeze([...this.#recorded]);
  }

  /** The same sequence as plain milliseconds, which is what assertions want. */
  get millis(): readonly number[] {
    return Object.freeze(this.#recorded.map((duration) => duration.toMillis()));
  }

  reset(): this {
    this.#recorded.length = 0;
    return this;
  }

  /** Not `async`: a bad argument must panic at the call site, not in a rejection. */
  sleep(duration: Duration): Promise<void> {
    const millis = sleepMillis(duration, "TestSleeper.sleep");
    this.#recorded.push(duration);
    this.#clock?.advance(millis);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Schedule values
// ---------------------------------------------------------------------------

/** The multiplicative band a driver draws a jitter factor from. */
export interface JitterBand {
  readonly min: number;
  readonly max: number;
}

/** What a driver knows when it consults a schedule. */
export interface ScheduleInfo {
  /** Attempts completed so far, 1-based: `1` on the first decision. */
  readonly attempt: number;
  /** Time observed since the driver started. */
  readonly elapsed: Duration;
}

declare const scheduleStateBrand: unique symbol;

/**
 * A schedule's own carry between steps. Opaque on purpose: it comes from
 * `initial()` or from a previous decision and belongs to the schedule that
 * produced it. Handing one schedule another's state panics.
 */
export type ScheduleState = { readonly [scheduleStateBrand]: never };

/**
 * The result of one pure step.
 *
 * `delay` is the deterministic delay; `jitter` and `maxDelay` are the two
 * pieces a driver still has to apply — a jitter factor is drawn from `Random`
 * and multiplies `delay`, and `maxDelay` then caps whatever came out. A cap
 * therefore really is a ceiling: `s.jittered().withMaxDelay(d)` and
 * `s.withMaxDelay(d).jittered()` produce the same bound.
 */
export interface ScheduleDecision {
  readonly continue: boolean;
  readonly delay: Duration;
  readonly jitter: JitterBand | undefined;
  readonly maxDelay: Duration | undefined;
  readonly state: ScheduleState;
}

/** Internal, millisecond-shaped mirror of `ScheduleInfo`. */
interface StepInfo {
  readonly attempt: number;
  readonly elapsedMillis: number;
}

/** Internal, millisecond-shaped mirror of `ScheduleDecision`. */
interface RawDecision {
  readonly continue: boolean;
  readonly delayMillis: number;
  readonly jitter: JitterBand | undefined;
  readonly capMillis: number | undefined;
  readonly state: unknown;
}

interface Node {
  readonly label: string;
  /** Whether anything in the tree jitters, so a driver can resolve `Random` eagerly. */
  readonly needsRandom: boolean;
  readonly initial: unknown;
  readonly step: (state: unknown, info: StepInfo) => RawDecision;
}

const nodesBySchedule = new WeakMap<object, Node>();
const localSchedules = new WeakSet<object>();

function nodeOf(schedule: Schedule): Node {
  const node = nodesBySchedule.get(schedule as object);
  if (node === undefined || !localSchedules.has(schedule as object)) panic("forged Schedule value");
  return node;
}

function decision(
  keepGoing: boolean,
  delayMillis: number,
  state: unknown,
  jitter: JitterBand | undefined = undefined,
  capMillis: number | undefined = undefined,
): RawDecision {
  return { continue: keepGoing, delayMillis, jitter, capMillis, state };
}

function checkedInfo(info: ScheduleInfo, caller: string): StepInfo {
  if (typeof info !== "object" || info === null) panic(`${caller} requires an info record`);
  if (!Number.isSafeInteger(info.attempt) || info.attempt < 1) {
    panic(`${caller} requires a 1-based whole attempt count`);
  }
  if (!Duration.isDuration(info.elapsed)) panic(`${caller} requires an elapsed Duration`);
  const elapsedMillis = info.elapsed.toMillis();
  if (elapsedMillis < 0) panic(`${caller} requires a non-negative elapsed Duration`);
  return { attempt: info.attempt, elapsedMillis };
}

function publicDecision(raw: RawDecision): ScheduleDecision {
  return Object.freeze({
    continue: raw.continue,
    delay: durationFromMillis(raw.delayMillis, "Schedule.step"),
    jitter: raw.jitter,
    maxDelay: raw.capMillis === undefined ? undefined : durationFromMillis(raw.capMillis, "Schedule.step"),
    state: raw.state as ScheduleState,
  });
}

/**
 * An immutable, non-forgeable retry/repeat policy. Branded with a module-private
 * `WeakSet` exactly the way `Duration` and `ConfigSpec` are, so a structural
 * look-alike cannot be driven.
 */
export abstract class ScheduleValue {
  /** The carry to hand the first `step`. */
  initial(): ScheduleState {
    return nodeOf(this).initial as ScheduleState;
  }

  /** One pure decision. Deterministic: no clock is read and no number is drawn. */
  step(state: ScheduleState, info: ScheduleInfo): ScheduleDecision {
    const node = nodeOf(this);
    return publicDecision(node.step(state as unknown, checkedInfo(info, "Schedule.step")));
  }

  /**
   * Intersection: continue only while **both** continue, and wait for the
   * **later** of the two (`max` delay). The classic bounded backoff is
   * `Schedule.exponential(base).and(Schedule.recurs(5))`.
   */
  and(other: Schedule): Schedule {
    return combined("and", this, other, "Schedule.and");
  }

  /**
   * Union: continue while **either** continues, and wait for the **earlier** of
   * the sides that are still going (`min` delay).
   */
  or(other: Schedule): Schedule {
    return combined("or", this, other, "Schedule.or");
  }

  /**
   * Multiply each delay by a factor drawn uniformly from `[min, max)`.
   *
   * The draw happens in the driver, through `Random.context()`, never here:
   * construction stays pure, and only *running* a jittered schedule adds
   * `Random` to the requirements. Defaults are `0.8`/`1.2` — ±20%, enough to
   * break up a thundering herd without materially changing the backoff curve.
   * An outer `.jittered()` replaces an inner one rather than compounding.
   */
  jittered(min = 0.8, max = 1.2): Schedule {
    if (typeof min !== "number" || typeof max !== "number") panic("Schedule.jittered requires numeric bounds");
    if (!Number.isFinite(min) || !Number.isFinite(max)) panic("Schedule.jittered requires finite bounds");
    if (min < 0) panic("Schedule.jittered requires a non-negative lower bound");
    if (max < min) panic("Schedule.jittered requires min <= max");
    const inner = nodeOf(this);
    const band: JitterBand = Object.freeze({ min, max });
    return makeSchedule({
      label: `${inner.label}.jittered(${min}, ${max})`,
      needsRandom: true,
      initial: inner.initial,
      step: (state, info) => {
        const next = inner.step(state, info);
        return decision(next.continue, next.delayMillis, next.state, band, next.capMillis);
      },
    });
  }

  /** Ceiling on the delay, applied after any jitter. Nested caps take the tighter one. */
  withMaxDelay(cap: Duration): Schedule {
    const capMillis = requireDelay(cap, "Schedule.withMaxDelay");
    const inner = nodeOf(this);
    return makeSchedule({
      label: `${inner.label}.withMaxDelay(${cap.toString()})`,
      needsRandom: inner.needsRandom,
      initial: inner.initial,
      step: (state, info) => {
        const next = inner.step(state, info);
        const tightest = next.capMillis === undefined ? capMillis : Math.min(next.capMillis, capMillis);
        return decision(next.continue, Math.min(next.delayMillis, capMillis), next.state, next.jitter, tightest);
      },
    });
  }

  /**
   * The delays this schedule produces for up to `maxSteps` instantaneous
   * attempts, stopping early where the schedule stops. Pure — it needs no
   * capability — so jitter is *not* applied; the returned delays are the
   * deterministic ones a driver would then jitter.
   */
  preview(maxSteps: number): readonly Duration[] {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) panic("Schedule.preview requires a non-negative whole count");
    const node = nodeOf(this);
    const delays: Duration[] = [];
    let state = node.initial;
    let elapsedMillis = 0;
    for (let attempt = 1; attempt <= maxSteps; attempt++) {
      const next = node.step(state, { attempt, elapsedMillis });
      if (!next.continue) break;
      delays.push(durationFromMillis(next.delayMillis, "Schedule.preview"));
      elapsedMillis = Math.min(elapsedMillis + next.delayMillis, MAX_DURATION_MILLIS);
      state = next.state;
    }
    return Object.freeze(delays);
  }

  /** Structural rendering, e.g. `(exponential(100ms, x2) and recurs(4))`. */
  toString(): string {
    return nodeOf(this).label;
  }

  get [Symbol.toStringTag](): string {
    return "Schedule";
  }
}

export type Schedule = ScheduleValue;

class LocalSchedule extends ScheduleValue {
  constructor(node: Node) {
    super();
    nodesBySchedule.set(this, Object.freeze(node));
    localSchedules.add(this);
    Object.freeze(this);
  }
}

function makeSchedule(node: Node): Schedule {
  return new LocalSchedule(node);
}

function isSchedule(value: unknown): value is Schedule {
  return typeof value === "object" && value !== null && localSchedules.has(value);
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

function requireDelay(value: Duration, caller: string): number {
  if (!Duration.isDuration(value)) panic(`${caller} requires a Duration`);
  const millis = value.toMillis();
  if (millis < 0) panic(`${caller} requires a non-negative Duration`);
  return millis;
}

function countState(state: unknown, caller: string): number {
  if (typeof state !== "number" || !Number.isSafeInteger(state) || state < 0) {
    panic(`${caller} received a state that did not come from this schedule`);
  }
  return state;
}

function pairState(state: unknown, caller: string): { readonly left: unknown; readonly right: unknown } {
  if (typeof state !== "object" || state === null || !("left" in state) || !("right" in state)) {
    panic(`${caller} received a state that did not come from this schedule`);
  }
  return state as { readonly left: unknown; readonly right: unknown };
}

/**
 * A fixed *rate*: boundaries at `period`, `2 * period`, … from the driver's
 * start, regardless of how long each attempt takes. An attempt that overruns a
 * boundary is followed immediately (delay zero) rather than skipping ahead, so
 * the schedule catches up instead of drifting. Never stops on its own.
 */
function fixed(period: Duration): Schedule {
  const periodMillis = requireDelay(period, "Schedule.fixed");
  return makeSchedule({
    label: `fixed(${period.toString()})`,
    needsRandom: false,
    initial: 0,
    step: (state, info) => {
      const completed = countState(state, "Schedule.fixed");
      const boundary = Math.min(periodMillis * (completed + 1), MAX_DURATION_MILLIS);
      return decision(true, Math.max(0, boundary - info.elapsedMillis), completed + 1);
    },
  });
}

/** A fixed *gap between completions*: always exactly `delay`. Never stops on its own. */
function spaced(delay: Duration): Schedule {
  const delayMillis = requireDelay(delay, "Schedule.spaced");
  return makeSchedule({
    label: `spaced(${delay.toString()})`,
    needsRandom: false,
    initial: null,
    step: (state, _info) => decision(true, delayMillis, state),
  });
}

/**
 * `base`, `base * factor`, `base * factor²`, … Each delay is computed from the
 * step index rather than by repeatedly multiplying the previous one, so a
 * fractional factor cannot accumulate drift. Results are rounded to whole
 * milliseconds and **saturate** at `MAX_DURATION_MILLIS` instead of panicking:
 * an unbounded exponential is expected to run off the end, and a caller who
 * cares bounds it with `.withMaxDelay(...)` or `.and(Schedule.recurs(n))`.
 */
function exponential(base: Duration, factor = 2): Schedule {
  const baseMillis = requireDelay(base, "Schedule.exponential");
  if (typeof factor !== "number") panic("Schedule.exponential requires a numeric factor");
  if (!Number.isFinite(factor) || factor <= 0) panic("Schedule.exponential requires a finite positive factor");
  return makeSchedule({
    label: `exponential(${base.toString()}, x${factor})`,
    needsRandom: false,
    initial: 0,
    step: (state, _info) => {
      const index = countState(state, "Schedule.exponential");
      const raw = baseMillis * factor ** index;
      const millis = Number.isFinite(raw) ? Math.min(Math.round(raw), MAX_DURATION_MILLIS) : MAX_DURATION_MILLIS;
      return decision(true, millis, index + 1);
    },
  });
}

/**
 * At most `times` recurrences with no delay of its own — that is, `times`
 * retries after the first attempt, or `times + 1` total attempts under
 * `Schedule.retry`. `recurs(0)` never continues.
 */
function recurs(times: number): Schedule {
  if (typeof times !== "number") panic("Schedule.recurs requires a number");
  if (!Number.isSafeInteger(times) || times < 0) panic("Schedule.recurs requires a non-negative whole count");
  return makeSchedule({
    label: `recurs(${times})`,
    needsRandom: false,
    initial: 0,
    step: (state, _info) => {
      const used = countState(state, "Schedule.recurs");
      return decision(used < times, 0, used + 1);
    },
  });
}

/**
 * Continue while the elapsed time *observed at the decision* is below `total`;
 * contributes no delay of its own. The check is against elapsed-so-far, not
 * elapsed-plus-the-next-delay, so a schedule may still sleep past the budget —
 * pair it with `.withMaxDelay(...)` when the overshoot matters.
 */
function upTo(total: Duration): Schedule {
  const totalMillis = requireDelay(total, "Schedule.upTo");
  return makeSchedule({
    label: `upTo(${total.toString()})`,
    needsRandom: false,
    initial: null,
    step: (state, info) => decision(info.elapsedMillis < totalMillis, 0, state),
  });
}

/**
 * Both sides always step, so neither's state goes stale. A cap declared
 * anywhere in the tree is respected (the tightest wins); a jitter band travels
 * with the delay that won the comparison, and ties go to the left.
 */
function combined(mode: "and" | "or", left: Schedule, right: Schedule, caller: string): Schedule {
  if (!isSchedule(left) || !isSchedule(right)) panic(`${caller} requires a Schedule`);
  const leftNode = nodeOf(left);
  const rightNode = nodeOf(right);
  return makeSchedule({
    label: `(${leftNode.label} ${mode} ${rightNode.label})`,
    needsRandom: leftNode.needsRandom || rightNode.needsRandom,
    initial: Object.freeze({ left: leftNode.initial, right: rightNode.initial }),
    step: (state, info) => {
      const pair = pairState(state, `Schedule.${mode}`);
      const a = leftNode.step(pair.left, info);
      const b = rightNode.step(pair.right, info);
      const next = Object.freeze({ left: a.state, right: b.state });
      const caps = [a.capMillis, b.capMillis].filter((value): value is number => value !== undefined);
      const capMillis = caps.length === 0 ? undefined : Math.min(...caps);

      if (mode === "and") {
        const takeLeft = a.delayMillis >= b.delayMillis;
        const winner = takeLeft ? a : b;
        return decision(a.continue && b.continue, winner.delayMillis, next, winner.jitter, capMillis);
      }

      if (!a.continue && !b.continue) return decision(false, 0, next, undefined, capMillis);
      // Only the sides that are still going get a say in how long to wait.
      const winner = !b.continue ? a : !a.continue ? b : a.delayMillis <= b.delayMillis ? a : b;
      return decision(true, winner.delayMillis, next, winner.jitter, capMillis);
    },
  });
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

/** Something worth retrying: an ordinary function returning a `Result`. */
export type Operation<A, E extends Error> = () => Result<A, E> | PromiseLike<Result<A, E>>;

export interface DriverOptions {
  /**
   * Overrides both the `Sleeper` capability and the host-timer default. This is
   * the seam a test uses to run a multi-hour policy instantly.
   */
  readonly sleeper?: Sleeper;
}

const DEFAULT_SLEEPER: Sleeper = SystemSleeper.make();

/**
 * The runtime has no "capability if provided" lookup — `useCapability` panics
 * when the key is absent — so an *optional* capability is read by catching that
 * panic. It is safe here because `Sleeper.context()` performs a map lookup and
 * runs no user code, so the only panic it can raise is the missing-capability
 * one this fallback is for.
 */
function resolveSleeper(explicit: Sleeper | undefined, caller: string): Sleeper {
  if (explicit !== undefined) {
    if (!(explicit instanceof Sleeper)) panic(`${caller} sleeper option must be a Sleeper`);
    return explicit;
  }
  return catchPanic(() => Sleeper.context(), () => DEFAULT_SLEEPER);
}

function elapsedMillisSince(clock: Clock, startMonotonic: number, caller: string): number {
  const now = clock.monotonic();
  if (typeof now !== "number" || !Number.isFinite(now)) panic(`${caller} read a non-finite monotonic time`);
  // `performance.now()` is fractional and only differences are meaningful; a
  // clock that went backwards is clamped rather than turned into a negative span.
  return Math.min(Math.max(0, Math.round(now - startMonotonic)), MAX_DURATION_MILLIS);
}

function finalDelayMillis(raw: RawDecision, random: Random | undefined, caller: string): number {
  let millis = raw.delayMillis;
  if (raw.jitter !== undefined) {
    if (random === undefined) panic(`${caller} needs the Random capability to jitter a delay`);
    const draw = random.next();
    if (typeof draw !== "number" || !Number.isFinite(draw) || draw < 0 || draw >= 1) {
      panic("Random.next returned a value outside [0, 1)");
    }
    millis = Math.round(millis * (raw.jitter.min + draw * (raw.jitter.max - raw.jitter.min)));
  }
  if (raw.capMillis !== undefined) millis = Math.min(millis, raw.capMillis);
  if (!Number.isFinite(millis)) return MAX_DURATION_MILLIS;
  return Math.min(Math.max(0, millis), MAX_DURATION_MILLIS);
}

async function runOnce<A, E extends Error>(operation: Operation<A, E>, caller: string): Promise<Result<A, E>> {
  if (typeof operation !== "function") panic(`${caller} requires an operation function`);
  const produced: unknown = operation();
  const settled: unknown = produced !== null && typeof produced === "object" && "then" in produced
    ? await (produced as PromiseLike<unknown>)
    : produced;
  if (!isResult(settled)) panic(`${caller} operation must return a Result`);
  return settled as Result<A, E>;
}

/** Everything a running loop needs, all of it resolved synchronously up front. */
interface Driver {
  readonly caller: string;
  readonly repeatWhileOk: boolean;
  readonly node: Node;
  readonly clock: Clock;
  readonly sleeper: Sleeper;
  readonly random: Random | undefined;
}

/**
 * The synchronous half of a driver: argument checks and capability resolution.
 *
 * Deliberately *not* `async`. A bad argument and a missing capability are
 * programmer errors, and a panic must reach the caller as a throw the way it
 * does everywhere else in the platform — an `async` prologue would quietly
 * demote both to a rejected Promise. Resolving here also means the driver still
 * works inside a synchronous `Layer.provide` scope on hosts without exact
 * Promise settlement hooks, which is the only shape Bun supports today.
 *
 * `Random` is resolved only when the schedule tree actually contains a
 * `.jittered(...)`, so an unjittered policy does not drag the capability into
 * its caller's requirements.
 */
function prepare(
  caller: string,
  repeatWhileOk: boolean,
  schedule: Schedule,
  operation: Operation<unknown, Error>,
  options: DriverOptions,
): Driver {
  if (!isSchedule(schedule)) panic(`${caller} requires a Schedule`);
  if (typeof operation !== "function") panic(`${caller} requires an operation function`);
  if (typeof options !== "object" || options === null) panic(`${caller} options must be a record`);
  const node = nodeOf(schedule);
  const sleeper = resolveSleeper(options.sleeper, caller);
  return { caller, repeatWhileOk, node, clock: Clock.context(), sleeper, random: node.needsRandom ? Random.context() : undefined };
}

/**
 * Panic policy, shared by both drivers: **a panic aborts immediately and is
 * never retried.** A panic is a broken invariant, not a transient condition, so
 * repeating the call can only repeat the bug — and swallowing it into a delay
 * loop would hide it from `catchPanic`. Both shapes behave the same way: an
 * operation that *throws* a `Panic` lets it propagate, and one that *returns*
 * `failure(panic)` has it rethrown here by `rethrowPanics`, exactly as every
 * other platform service does at its boundary. An ordinary exception is not
 * caught either: `retry` retries *failures*, and turning a throw into one would
 * invent a failure the operation never declared.
 */
async function drive<A, E extends Error>(
  driver: Driver,
  operation: Operation<A, E>,
): Promise<Result<A, Exclude<E, Panic>>> {
  const { caller, node, clock, sleeper, random } = driver;
  const startMonotonic = clock.monotonic();
  let state = node.initial;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const outcome = rethrowPanics(
      await runOnce(operation, caller) as Result<A, Exclude<E, Panic> | Panic>,
    );
    // retry keeps going on a failure, repeat keeps going on a success.
    if (outcome.isOk() !== driver.repeatWhileOk) return outcome;

    const next = node.step(state, { attempt, elapsedMillis: elapsedMillisSince(clock, startMonotonic, caller) });
    if (!next.continue) return outcome;
    state = next.state;
    // Even a zero delay goes through the sleeper: it keeps the observed sleep
    // sequence complete, and it stops a zero-delay policy from starving the
    // event loop under the live implementation.
    await sleeper.sleep(durationFromMillis(finalDelayMillis(next, random, caller), caller));
  }
}

/**
 * Run `operation`, and on a **failure** consult `schedule` for whether and when
 * to try again. Returns the first success, or the last failure once the
 * schedule stops. Requires `Clock`, plus `Random` when the schedule jitters.
 */
function retry<A, E extends Error>(
  schedule: Schedule,
  operation: Operation<A, E>,
  options: DriverOptions = {},
): Promise<Result<A, Exclude<E, Panic>>> {
  return drive(prepare("Schedule.retry", false, schedule, operation as Operation<unknown, Error>, options), operation);
}

/**
 * Run `operation`, and on a **success** consult `schedule` for whether and when
 * to run it again. Returns the last success once the schedule stops, or the
 * first failure — a failure ends the repetition and is returned as-is.
 */
function repeat<A, E extends Error>(
  schedule: Schedule,
  operation: Operation<A, E>,
  options: DriverOptions = {},
): Promise<Result<A, Exclude<E, Panic>>> {
  return drive(prepare("Schedule.repeat", true, schedule, operation as Operation<unknown, Error>, options), operation);
}

export const Schedule = Object.freeze({
  fixed,
  spaced,
  exponential,
  recurs,
  upTo,
  isSchedule,
  retry,
  repeat,
});

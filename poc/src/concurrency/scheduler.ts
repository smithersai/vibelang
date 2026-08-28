/**
 * `Scheduler`: the capability every concurrent effect request is dispatched
 * through, and the counter that says whether that is actually true.
 *
 * **Status: provisional, and exported from nowhere.** Nothing in the tree
 * routes through this module yet. `concurrency/index.ts` does not re-export it
 * and `platform/layers.ts` does not provide it; wiring it in is a later step.
 *
 * ---
 *
 * ## Why this exists at all
 *
 * `specification/durable-execution.mdx` §Deterministic Scheduling (new with the
 * continuation pivot): "Concurrent effect requests inside a Flow body MUST be
 * dispatched through a runtime-owned scheduler. The scheduler MUST assign each
 * request a submission index in a deterministic order derived from program
 * order, MUST journal the order in which requests completed, and on resumption
 * MUST deliver completions in the journaled order. A combinator whose result
 * depends on arrival order — including `Promise.race` and `Promise.any` — MUST
 * NOT be reachable except through the scheduler."
 *
 * There is no deterministic scheduler anywhere in this tree today, and
 * `wakeup.ts` explicitly disclaims being one. This is the new subsystem.
 *
 * ## Why the counter exists, which is the more important half
 *
 * The migration plan's own risk register is blunt about the failure mode:
 *
 * > "The dangerous outcome is that the scheduler step breaks nothing. Every
 * > `Promise.race` can be swapped for `firstReady` while the implementation is
 * > still `Promise.race`; every test passes. No gate in the tree can see an
 * > unjournaled interleaving, because the observable output is identical."
 *
 * A swap that keeps arrival-order semantics is invisible to every assertion in
 * the repository, because the *values* produced are the same values. The only
 * thing that differs is whether each concurrent submission carried a
 * deterministic index — and that is not observable in any output.
 *
 * So it is made observable here. {@link Scheduler.firstReady} and
 * {@link Scheduler.allReady} accept a bare promise as well as a ticketed
 * {@link Submission}, deliberately: a naive `Promise.race(xs)` →
 * `scheduler.firstReady(xs)` swap must COMPILE and RUN, so that
 * {@link ReplayScheduler.unticketed} can catch it. Making the bare form a type
 * error instead would move the detection to `tsc`, which sounds stricter and is
 * actually weaker — a caller under pressure writes `xs.map(untracked)` and the
 * type error goes away silently, whereas the counter still counts.
 *
 * ## No ambient fallback
 *
 * {@link schedulerFor} resolves an explicit scheduler, then
 * `Scheduler.context()`, and then nothing. `platform/schedule.ts` records what
 * the third step costs: `Sleeper` used to end in a swallowed panic that handed
 * back `globalThis.setTimeout`, so `Schedule.retry` slept on a host timer
 * whenever nobody had provided a `Sleeper` — including under the deterministic
 * `TestPlatform` bundle, whose `TestClock` meanwhile reported frozen time. A
 * scheduler that falls back to `Promise.race` when unprovided has exactly that
 * shape and exactly that failure: it degrades to arrival order, silently, in
 * the environment that exists to be deterministic. This one refuses.
 */

import { Clock, TestClock } from "../platform/clock.ts";
import { Context } from "../runtime/layer.ts";
import { panic } from "../runtime/panic.ts";

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/**
 * A deterministic submission index.
 *
 * `index` is assigned in the order submissions are made, which for a
 * single-threaded body issuing requests in program order IS program order —
 * the spec's requirement, not an approximation of it. `site` is the effect site
 * the submission came from; it is what a divergence report names, and what
 * makes an unticketed submission diagnosable rather than merely counted.
 */
export interface Ticket {
  readonly index: number;
  readonly site: string;
}

/** A concurrent operation that carries its deterministic submission index. */
export interface Submission<T> {
  readonly ticket: Ticket;
  readonly work: PromiseLike<T>;
}

/**
 * Something handed to {@link Scheduler.firstReady} or
 * {@link Scheduler.allReady}.
 *
 * The bare-promise arm is the detector's whole point; see the module comment.
 */
export type Contender<T> = Submission<T> | PromiseLike<T>;

function isSubmission<T>(value: Contender<T>): value is Submission<T> {
  return typeof value === "object" && value !== null && "ticket" in value && "work" in value;
}

/** One entry of the completion order a run observed. */
export interface Completion {
  /** The winning ticket's index, or `-1` for an unticketed contender. */
  readonly index: number;
  readonly site: string;
  /**
   * The deterministic clock reading when the completion was observed, when the
   * scheduler was bound to a `TestClock`. Evidence that no real time passed; it
   * is NOT part of journal identity, which is `(index, site)` alone.
   */
  readonly at?: number;
}

/** What the ticket audit says about one run. Read by tests, not by the runtime. */
export interface TicketAudit {
  /** Every concurrent contender this scheduler was handed. */
  readonly submissions: number;
  /** Those handed over WITHOUT a deterministic submission index. */
  readonly unticketed: number;
  /** Where each unticketed submission came from, in order, for diagnosis. */
  readonly unticketedSites: readonly string[];
}

const UNTICKETED_SITE = "<unticketed>";

// ---------------------------------------------------------------------------
// The capability
// ---------------------------------------------------------------------------

/**
 * Dispatching concurrent work.
 *
 * Shaped after `Sleeper` (`platform/schedule.ts`): a capability, a live
 * implementation over the host, a deterministic implementation for replay, no
 * ambient fallback, and a refusal rather than a degradation when the
 * deterministic one is asked for something it cannot reproduce.
 */
export abstract class Scheduler extends Context {
  /** Mint the next deterministic submission index for `site`. */
  abstract ticket(site: string): Ticket;

  /** Start `work` under `ticket`. */
  abstract submit<T>(ticket: Ticket, work: () => PromiseLike<T> | T): Submission<T>;

  /**
   * Resolve with the first contender to become ready.
   *
   * This is the arrival-order operation — the one `Promise.race` and
   * `Promise.any` are, and the one the spec says MUST NOT be reachable except
   * through a scheduler.
   */
  abstract firstReady<T>(contenders: Iterable<Contender<T>>): Promise<T>;

  /**
   * Wait for every contender, answering in submission order.
   *
   * `Promise.all` is order-INDEPENDENT — its answer does not depend on arrival
   * order — which is why the determinism-enforcement step charges a `Scheduler`
   * requirement for `Promise.race`/`Promise.any` and leaves every other
   * `Promise` member free. It nevertheless STARTS concurrent requests, and the
   * spec says every concurrent request MUST get a deterministic submission
   * index before dispatch. Those two locked obligations are in tension, and
   * this method does not settle it: it exists so the tension has a name and a
   * measurement point. See {@link ReplayScheduler.unticketed} for exactly what
   * the counter does and does not see on this path.
   */
  abstract allReady<T>(contenders: Iterable<Contender<T>>): Promise<readonly T[]>;
}

/**
 * Resolve the scheduler an operation will use: an explicit one, else the
 * `Scheduler` the enclosing Layer provides.
 *
 * There is deliberately no third step. See the module comment.
 */
export function schedulerFor(explicit: Scheduler | undefined, caller: string): Scheduler {
  if (explicit !== undefined) {
    if (!(explicit instanceof Scheduler)) panic(`${caller} scheduler option must be a Scheduler`);
    return explicit;
  }
  return Scheduler.context();
}

// ---------------------------------------------------------------------------
// Shared normalization
// ---------------------------------------------------------------------------

interface Normalized<T> {
  readonly ticket: Ticket | undefined;
  readonly work: PromiseLike<T>;
}

function normalize<T>(contenders: Iterable<Contender<T>>, caller: string): readonly Normalized<T>[] {
  if (contenders === null || typeof contenders !== "object" || !(Symbol.iterator in contenders)) {
    panic(`${caller} requires an iterable of contenders`);
  }
  const out: Normalized<T>[] = [];
  for (const contender of contenders) {
    if (contender === null || (typeof contender !== "object" && typeof contender !== "function")) {
      panic(`${caller} contenders must be submissions or promises`);
    }
    if (isSubmission(contender)) {
      checkTicket(contender.ticket, caller);
      out.push({ ticket: contender.ticket, work: contender.work });
    } else {
      out.push({ ticket: undefined, work: contender });
    }
  }
  return out;
}

function checkTicket(ticket: Ticket, caller: string): Ticket {
  if (typeof ticket !== "object" || ticket === null) panic(`${caller} requires a Ticket`);
  if (!Number.isSafeInteger(ticket.index) || ticket.index < 0) {
    panic(`${caller} requires a non-negative whole submission index`);
  }
  if (typeof ticket.site !== "string" || ticket.site.length === 0) {
    panic(`${caller} requires a non-empty site`);
  }
  return ticket;
}

/** Tag each contender's settlement with the contender it came from. */
function tagged<T>(entry: Normalized<T>, position: number): Promise<{ readonly position: number; readonly value: T }> {
  return Promise.resolve(entry.work).then((value) => ({ position, value }));
}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

/**
 * Live scheduler. Arrival order is the host's, which is correct outside a
 * durable body and unusable inside one — which is why this class is not the
 * one that carries the counter.
 */
export class HostScheduler extends Scheduler {
  #next = 0;

  private constructor() {
    super();
  }

  static make(): HostScheduler {
    return new HostScheduler();
  }

  ticket(site: string): Ticket {
    if (typeof site !== "string" || site.length === 0) panic("HostScheduler.ticket requires a non-empty site");
    return Object.freeze({ index: this.#next++, site });
  }

  submit<T>(ticket: Ticket, work: () => PromiseLike<T> | T): Submission<T> {
    checkTicket(ticket, "HostScheduler.submit");
    if (typeof work !== "function") panic("HostScheduler.submit requires a work function");
    return Object.freeze({ ticket, work: Promise.resolve().then(work) });
  }

  firstReady<T>(contenders: Iterable<Contender<T>>): Promise<T> {
    const entries = normalize(contenders, "HostScheduler.firstReady");
    if (entries.length === 0) panic("HostScheduler.firstReady requires at least one contender");
    return Promise.race(entries.map((entry) => Promise.resolve(entry.work)));
  }

  allReady<T>(contenders: Iterable<Contender<T>>): Promise<readonly T[]> {
    const entries = normalize(contenders, "HostScheduler.allReady");
    return Promise.all(entries.map((entry) => Promise.resolve(entry.work)));
  }
}

// ---------------------------------------------------------------------------
// Deterministic implementation
// ---------------------------------------------------------------------------

export interface ReplaySchedulerOptions {
  /**
   * Binds the scheduler to the same deterministic clock the rest of the
   * `TestPlatform` bundle uses, exactly as `TestSleeper.make({ clock })` does.
   * A live `Clock` is refused rather than accepted-and-ignored: a deterministic
   * scheduler reading real time is the defect, not the configuration.
   */
  readonly clock?: TestClock;
  /**
   * A completion order a previous run observed. When present the scheduler
   * REPLAYS it: `firstReady` answers with the contender the journal names,
   * whatever the host's arrival order is this time, and refuses if the body did
   * not offer that contender.
   */
  readonly journal?: readonly Completion[];
}

/**
 * Deterministic scheduler, and the tree's only detector for an unjournaled
 * interleaving.
 */
export class ReplayScheduler extends Scheduler {
  readonly #clock: TestClock | undefined;
  readonly #journal: readonly Completion[] | undefined;
  readonly #observed: Completion[] = [];
  readonly #unticketedSites: string[] = [];
  #next = 0;
  #submissions = 0;
  #unticketed = 0;
  #cursor = 0;

  private constructor(clock: TestClock | undefined, journal: readonly Completion[] | undefined) {
    super();
    this.#clock = clock;
    this.#journal = journal;
  }

  static make(options: ReplaySchedulerOptions = {}): ReplayScheduler {
    if (typeof options !== "object" || options === null) panic("ReplayScheduler.make options must be a record");
    if (options.clock !== undefined && !(options.clock instanceof TestClock)) {
      // A live Clock here would make every completion stamp real time, which is
      // the thing a deterministic scheduler exists to not do.
      panic("ReplayScheduler.make clock option must be a TestClock");
    }
    if (options.journal !== undefined && !Array.isArray(options.journal)) {
      panic("ReplayScheduler.make journal option must be an array of completions");
    }
    return new ReplayScheduler(options.clock, options.journal === undefined ? undefined : Object.freeze([...options.journal]));
  }

  /**
   * How many concurrent operations were submitted WITHOUT a deterministic
   * submission index. **This is the number the whole scheduler step is worth.**
   *
   * A `Promise.race` swapped for `firstReady` while the callers still hand over
   * bare promises produces identical output, passes every existing assertion,
   * and moves this counter off zero. Nothing else in the tree can tell those
   * two situations apart.
   *
   * **What it does not see.** Only work that reaches this scheduler is counted.
   * Concurrency started by a combinator that never charges a `Scheduler` — and
   * `Promise.all` is exactly that combinator, because its answer is
   * order-independent — dispatches without passing through here at all, so the
   * counter reads zero over it. The hole is the size of the `Promise.all`
   * tension and is not closed by this class; it is named here so a zero cannot
   * be mistaken for a proof.
   *
   * **A zero is also not a proof when nothing ran.** Use
   * {@link assertFullyTicketed}, which refuses to pass vacuously.
   */
  get unticketed(): number {
    return this.#unticketed;
  }

  /** The full audit, including where the unticketed submissions came from. */
  get audit(): TicketAudit {
    return Object.freeze({
      submissions: this.#submissions,
      unticketed: this.#unticketed,
      unticketedSites: Object.freeze([...this.#unticketedSites]),
    });
  }

  /** The completion order this run observed — what a journal would record. */
  get completions(): readonly Completion[] {
    return Object.freeze([...this.#observed]);
  }

  ticket(site: string): Ticket {
    if (typeof site !== "string" || site.length === 0) panic("ReplayScheduler.ticket requires a non-empty site");
    return Object.freeze({ index: this.#next++, site });
  }

  submit<T>(ticket: Ticket, work: () => PromiseLike<T> | T): Submission<T> {
    checkTicket(ticket, "ReplayScheduler.submit");
    if (typeof work !== "function") panic("ReplayScheduler.submit requires a work function");
    return Object.freeze({ ticket, work: Promise.resolve().then(work) });
  }

  async firstReady<T>(contenders: Iterable<Contender<T>>): Promise<T> {
    const entries = this.#account(contenders, "ReplayScheduler.firstReady");
    if (entries.length === 0) panic("ReplayScheduler.firstReady requires at least one contender");

    const expected = this.#journal?.[this.#cursor];
    if (expected !== undefined) {
      this.#cursor += 1;
      const position = entries.findIndex((entry) =>
        entry.ticket !== undefined && entry.ticket.index === expected.index && entry.ticket.site === expected.site
      );
      if (position < 0) {
        // Refuses rather than degrades. Falling back to arrival order here is
        // precisely the silent un-journaling this class exists to prevent.
        panic(
          `ReplayScheduler.firstReady diverged: the journal expects submission ${expected.index} at ${expected.site}, which this run did not offer`,
        );
      }
      const winner = await Promise.resolve(entries[position]!.work);
      this.#record(entries[position]!);
      return winner;
    }

    const { position, value } = await Promise.race(entries.map(tagged));
    this.#record(entries[position]!);
    return value;
  }

  async allReady<T>(contenders: Iterable<Contender<T>>): Promise<readonly T[]> {
    const entries = this.#account(contenders, "ReplayScheduler.allReady");
    // Order-independent by construction: the answer is in SUBMISSION order, so
    // no journal check is applied and no divergence is possible here. The
    // completion order is still recorded, because it is evidence about the
    // requests started underneath — see `allReady`'s doc comment on the tension.
    const settled = await Promise.all(entries.map(tagged));
    for (const { position } of [...settled].sort((left, right) => left.position - right.position)) {
      this.#record(entries[position]!);
    }
    return settled.map((entry) => entry.value);
  }

  #account<T>(contenders: Iterable<Contender<T>>, caller: string): readonly Normalized<T>[] {
    const entries = normalize(contenders, caller);
    for (const entry of entries) {
      this.#submissions += 1;
      if (entry.ticket === undefined) {
        this.#unticketed += 1;
        this.#unticketedSites.push(caller);
      }
    }
    return entries;
  }

  #record<T>(entry: Normalized<T>): void {
    const at = this.#clock?.monotonic();
    this.#observed.push(Object.freeze({
      index: entry.ticket?.index ?? -1,
      site: entry.ticket?.site ?? UNTICKETED_SITE,
      ...(at === undefined ? {} : { at }),
    }));
  }
}

// ---------------------------------------------------------------------------
// The assertion R6 exists for
// ---------------------------------------------------------------------------

export interface TicketAssertion {
  /**
   * Whether this scheduler was expected to see any concurrency at all. There is
   * NO DEFAULT, on purpose.
   *
   * A guard spelled `expect(scheduler.unticketed).toBe(0)` passes when the
   * scheduler saw nothing, which is the state the whole tree is in until the
   * combinators are routed through it — so the obvious spelling of this
   * assertion is a fail-open on arrival, and stays one for as long as the
   * routing takes. Requiring the caller to say which case it is in makes the
   * vacuous pass unwriteable by accident.
   */
  readonly concurrency: "expected" | "none";
}

/**
 * Assert that every concurrent submission this scheduler saw carried a
 * deterministic index — and that the assertion was not satisfied by a
 * scheduler that never ran.
 *
 * Throws rather than using a test framework's `expect`, so it can be called
 * from the runtime as well as from a test.
 */
export function assertFullyTicketed(
  scheduler: ReplayScheduler,
  assertion: TicketAssertion,
  label = "scheduler",
): void {
  if (!(scheduler instanceof ReplayScheduler)) {
    throw new TypeError("assertFullyTicketed requires a ReplayScheduler");
  }
  if (typeof assertion !== "object" || assertion === null) {
    throw new TypeError("assertFullyTicketed requires an assertion record");
  }
  if (assertion.concurrency !== "expected" && assertion.concurrency !== "none") {
    throw new TypeError('assertFullyTicketed requires concurrency: "expected" | "none"');
  }
  const { submissions, unticketed, unticketedSites } = scheduler.audit;
  if (assertion.concurrency === "expected" && submissions === 0) {
    throw new Error(
      `${label} saw no concurrent submissions, so "unticketed === 0" proves nothing here; ` +
        'pass concurrency: "none" if that is the intent',
    );
  }
  if (assertion.concurrency === "none" && submissions > 0) {
    throw new Error(
      `${label} was declared to see no concurrency but saw ${submissions} submission(s)`,
    );
  }
  if (unticketed > 0) {
    throw new Error(
      `${label} dispatched ${unticketed} of ${submissions} concurrent submission(s) without a deterministic ticket ` +
        `(at ${unticketedSites.join(", ")}); an unticketed submission is an unjournaled interleaving`,
    );
  }
}

/**
 * A deterministic scheduler bound to a `TestPlatform` bundle's clock.
 *
 * NOT part of `TestPlatform.make`. Putting `Scheduler` into `platformLayer` is
 * the wiring step, and doing it here would make this module observable — which
 * it must not be yet. This factory exists so that when the wiring lands, the
 * binding it needs already exists and has tests.
 */
export function testScheduler(bundle: { readonly clock: Clock }, journal?: readonly Completion[]): ReplayScheduler {
  if (typeof bundle !== "object" || bundle === null) panic("testScheduler requires a platform bundle");
  if (!(bundle.clock instanceof TestClock)) panic("testScheduler requires a bundle carrying a TestClock");
  return ReplayScheduler.make(journal === undefined ? { clock: bundle.clock } : { clock: bundle.clock, journal });
}

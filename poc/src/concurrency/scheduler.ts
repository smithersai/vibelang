/**
 * `Scheduler`: the capability every concurrent effect request is dispatched
 * through, and the counter that says whether that is actually true.
 *
 * **Status: wired, and required.** `concurrency/index.ts` re-exports it and
 * `platform/layers.ts` provides it as a non-optional platform service. Every
 * arrival-order decision in `join.ts`, `async-iterators.ts` and `stream.ts` is
 * dispatched through {@link Dispatch}, so `ReplayScheduler.unticketed` now
 * reads over the real combinators rather than over contenders a test handed
 * the scheduler directly.
 *
 * Four races were routed, and one of them was not spelled `Promise.race`:
 * `stream.ts`'s `cancellablePull` was a hand-rolled `new Promise` with a
 * first-wins `complete`. A migration driven by grepping for `Promise.race`
 * finds three and silently leaves that one behind, which is worth recording
 * because leaving it behind has no observable symptom.
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
 *
 * ## The journal round-trips
 *
 * {@link ReplayScheduler.journal} is exactly the value
 * {@link ReplaySchedulerOptions.journal} consumes, and recording a program then
 * replaying that recording against the same program is a property test, not an
 * example. It was neither for a while: the recorder wrote one untagged entry
 * per completion, the replayer read every entry as a `firstReady` decision, and
 * a program that mixed the two operations recorded a journal that panicked when
 * replayed against the body that produced it. Both halves had tests; nothing
 * composed them. {@link JournalRow} is the single type that both halves now
 * interpret, and it is keyed the way `durable-execution.mdx` §Journal Identity
 * says a journal entry must be keyed — `(site, occurrence)` — rather than by
 * position in a stream.
 *
 * The one deliberate non-refusal is a missing row. §Replay requires that "the
 * first request with no journal entry MUST be dispatched", because that is how
 * a resumed execution gets past the prefix it already recorded. That path is
 * therefore kept and *counted*: see {@link ReplayScheduler.dispatchedLive}.
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

// ---------------------------------------------------------------------------
// Journal rows
// ---------------------------------------------------------------------------

/** Which scheduler operation a journal row was recorded by. */
export type JournalOp = "firstReady" | "allReady";

/**
 * How a journal row names one submission: the ticket's `(index, site)`, or
 * `index: -1` for a contender that reached the scheduler without a ticket.
 */
export interface SubmissionKey {
  readonly index: number;
  readonly site: string;
}

/**
 * One row of the journal — the SAME type the recorder writes and the replayer
 * reads. There used to be two shapes hiding behind one field, and it did not
 * survive being composed.
 *
 * ## What a row means, and why `allReady` rows are not completion order
 *
 * A row records **one scheduler operation**, not one completed request. That is
 * the correction: the previous shape recorded one entry per *completion*, then
 * fed the whole stream to a cursor that read every entry as a `firstReady`
 * decision. So a program that mixed the two operations recorded rows that
 * replay could only misread, and the recorded field's own doc comment — "the
 * completion order this run observed" — was false for half of them.
 *
 * It was false in a second way. `Promise.all`'s output cannot observe arrival
 * order, so the `allReady` arm sorted its entries back into submission position
 * before recording them. Those rows were therefore submission order *whatever
 * happened at runtime*: a tautology wearing the name of an observation. There
 * is no completion order for an order-independent operation, and recording one
 * anyway is a lie the file told about itself.
 *
 * What an `allReady` DOES have worth pinning is {@link offered}: which
 * submissions the body dispatched, in submission order. That is a fact about
 * the body, it can change when the body changes, and `specification/
 * durable-execution.mdx` §Divergence requires exactly this check — "if the body
 * issues a request whose site identity does not match the journal entry at that
 * occurrence index ... MUST report a divergence". So `allReady` rows are
 * verified for their offered set and carry no {@link winner}, because there is
 * no arrival order to reproduce; `firstReady` rows are verified the same way
 * and additionally replay their winner.
 */
export interface JournalRow {
  /** The operation this row records. A row is never read as the other one. */
  readonly op: JournalOp;
  /**
   * The site identity of the OPERATION — the `(siteIdentity, occurrenceIndex)`
   * key `durable-execution.mdx` §Journal Identity mandates, not a position in a
   * stream. See {@link ReplayScheduler.firstReady} for what the default is and
   * what it costs.
   */
  readonly site: string;
  /** Which occurrence of {@link site} this is, counted at submission. */
  readonly occurrence: number;
  /** Every submission the operation was offered, in submission order. */
  readonly offered: readonly SubmissionKey[];
  /**
   * `firstReady` only: the submission the recorded run answered with. Absent on
   * `allReady` rows, and required on `firstReady` rows — a `firstReady` row
   * without a winner records nothing.
   */
  readonly winner?: SubmissionKey;
  /**
   * The deterministic clock reading when the row was recorded, when the
   * scheduler was bound to a `TestClock`. Evidence that no real time passed; it
   * is NOT part of journal identity, which is `(site, occurrence)` alone.
   */
  readonly at?: number;
}

/**
 * What replay did with the journal it was given. Read by tests, not the runtime.
 *
 * `replayed < rows` at the end of a body is the "completes while journal entries
 * remain unconsumed" divergence `durable-execution.mdx` §Divergence names. This
 * class cannot raise it — it is not told when the body ends — so the audit
 * exposes both numbers and the caller that owns the body boundary compares
 * them. That is a gap, stated rather than papered over.
 */
export interface ReplayAudit {
  /** Rows the journal supplied. */
  readonly rows: number;
  /** Operations answered from a journal row. */
  readonly replayed: number;
  /**
   * Operations the journal had no row for, which were therefore dispatched
   * live. See {@link ReplayScheduler.dispatchedLive}.
   */
  readonly dispatchedLive: number;
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
   *
   * `site` is the operation's site identity, which is half of the journal key
   * `durable-execution.mdx` §Journal Identity mandates. It is optional because
   * nothing in the tree can supply a content-addressed one yet; see
   * {@link ReplayScheduler.firstReady}.
   */
  abstract firstReady<T>(contenders: Iterable<Contender<T>>, site?: string): Promise<T>;

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
   *
   * What it does NOT record is a completion order, because it has none to
   * record — see {@link JournalRow}.
   */
  abstract allReady<T>(contenders: Iterable<Contender<T>>, site?: string): Promise<readonly T[]>;
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

/**
 * One concurrent arm of a combinator: a ticketed {@link Submission} once a
 * `Scheduler` is provided, and a bare promise while it is still optional.
 */
export type Arm<T> = Submission<T> | Promise<T>;

/** The promise inside an arm, for the cleanup joins that wait rather than race. */
export function armWork<T>(arm: Arm<T>): PromiseLike<T> {
  return isSubmission(arm) ? arm.work : arm;
}

/**
 * A combinator's whole view of the scheduler: start an arm, and ask which arm
 * is ready first.
 *
 * The point of routing every combinator through ONE seam is that the
 * `undefined`-scheduler arm exists in exactly one place instead of once per
 * call site. `join.ts` alone has two races and `async-iterators.ts` a third;
 * open-coding "scheduler ? firstReady : Promise.race" at each of them would
 * mean three chances to leave one behind, and a left-behind `Promise.race` is
 * invisible precisely because its output is identical.
 */
export interface Dispatch {
  /** Begin one concurrent arm, ticketed when a scheduler is present. */
  start<T>(site: string, work: () => Promise<T>): Arm<T>;
  /** Resolve with the first ready arm. This is the arrival-order operation. */
  firstReady<T>(site: string, arms: readonly Arm<T>[]): Promise<T>;
}

/**
 * Build the seam. Every arm carries a deterministic ticket and every race is
 * journalled.
 *
 * There used to be a second arm here, taken when no `Scheduler` was provided,
 * which fell back to `Promise.race`. It existed only so that the routing could
 * land one combinator at a time without any intermediate commit being broken.
 * It is gone, and it had to go: a fallback to arrival order is invisible in
 * every output, so a tree that keeps one has no way to tell a routed
 * combinator from an unrouted one. `Scheduler` is a required platform service
 * now, and an unprovided one panics like any other missing capability.
 */
export function dispatchVia(scheduler: Scheduler): Dispatch {
  if (!(scheduler instanceof Scheduler)) panic("dispatchVia requires a Scheduler");
  return Object.freeze({
    start: <T>(site: string, work: () => Promise<T>): Arm<T> => scheduler.submit(scheduler.ticket(site), work),
    firstReady: <T>(site: string, arms: readonly Arm<T>[]): Promise<T> => scheduler.firstReady(arms, site),
  });
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

function checkSubmissionKey(key: SubmissionKey, where: string): SubmissionKey {
  if (typeof key !== "object" || key === null) panic(`${where} requires submission keys`);
  if (!Number.isSafeInteger(key.index) || key.index < -1) {
    panic(`${where} requires a whole submission index (or -1 for unticketed)`);
  }
  if (typeof key.site !== "string" || key.site.length === 0) panic(`${where} requires a non-empty site`);
  return Object.freeze({ index: key.index, site: key.site });
}

function checkJournalRow(row: JournalRow, position: number): JournalRow {
  const where = `ReplayScheduler.make journal row ${position}`;
  if (typeof row !== "object" || row === null) panic(`${where} must be a record`);
  if (row.op !== "firstReady" && row.op !== "allReady") {
    panic(`${where} must carry op "firstReady" or "allReady"; an untagged row cannot be replayed`);
  }
  if (typeof row.site !== "string" || row.site.length === 0) panic(`${where} requires a non-empty site`);
  if (!Number.isSafeInteger(row.occurrence) || row.occurrence < 0) {
    panic(`${where} requires a non-negative occurrence index`);
  }
  if (!Array.isArray(row.offered)) panic(`${where} must list the submissions it was offered`);
  const offered = Object.freeze(row.offered.map((key) => checkSubmissionKey(key, where)));
  if (row.op === "firstReady") {
    if (row.winner === undefined) panic(`${where} is a firstReady row and must name the submission that won`);
  } else if (row.winner !== undefined) {
    panic(`${where} is an allReady row and must not name a winner; allReady observes no arrival order`);
  }
  return Object.freeze({
    op: row.op,
    site: row.site,
    occurrence: row.occurrence,
    offered,
    ...(row.winner === undefined ? {} : { winner: checkSubmissionKey(row.winner, where) }),
    ...(row.at === undefined ? {} : { at: row.at }),
  });
}

/** `(site, occurrence)` as one lookup key, length-prefixed so no site can forge another's. */
function rowKey(site: string, occurrence: number): string {
  return `${site.length}:${site}:${occurrence}`;
}

function describeKeys(keys: readonly SubmissionKey[]): string {
  return keys.length === 0 ? "nothing" : keys.map((key) => `${key.index}@${key.site}`).join(", ");
}

function keyOf<T>(entry: Normalized<T>): SubmissionKey {
  return Object.freeze({ index: entry.ticket?.index ?? -1, site: entry.ticket?.site ?? UNTICKETED_SITE });
}

function sameKeys(left: readonly SubmissionKey[], right: readonly SubmissionKey[]): boolean {
  return left.length === right.length &&
    left.every((key, at) => key.index === right[at]!.index && key.site === right[at]!.site);
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
   * The journal a previous run recorded — the value {@link
   * ReplayScheduler.journal} hands back, unchanged. When present the scheduler
   * REPLAYS it: each operation looks its own row up by `(site, occurrence)`,
   * `firstReady` answers with the submission that row names whatever the host's
   * arrival order is this time, and both operations refuse if the body did not
   * offer the submissions the row records.
   */
  readonly journal?: readonly JournalRow[];
}

/**
 * Deterministic scheduler, and the tree's only detector for an unjournaled
 * interleaving.
 */
export class ReplayScheduler extends Scheduler {
  readonly #clock: TestClock | undefined;
  readonly #journal: ReadonlyMap<string, JournalRow> | undefined;
  readonly #recorded: JournalRow[] = [];
  readonly #unticketedSites: string[] = [];
  readonly #occurrences = new Map<string, number>();
  #next = 0;
  #submissions = 0;
  #unticketed = 0;
  #replayed = 0;
  #dispatchedLive = 0;

  private constructor(clock: TestClock | undefined, journal: readonly JournalRow[] | undefined) {
    super();
    this.#clock = clock;
    if (journal === undefined) {
      this.#journal = undefined;
      return;
    }
    // Keyed by `(site, occurrence)`, not stored as a stream. A positional
    // cursor cannot tell "this request has no journal entry" from "the stream
    // is misaligned", and `durable-execution.mdx` §Replay needs exactly that
    // distinction to dispatch the first unjournaled request.
    const byKey = new Map<string, JournalRow>();
    for (const row of journal) {
      const key = rowKey(row.site, row.occurrence);
      if (byKey.has(key)) {
        panic(`ReplayScheduler.make journal has two rows for ${row.site} occurrence ${row.occurrence}`);
      }
      byKey.set(key, row);
    }
    this.#journal = byKey;
  }

  static make(options: ReplaySchedulerOptions = {}): ReplayScheduler {
    if (typeof options !== "object" || options === null) panic("ReplayScheduler.make options must be a record");
    if (options.clock !== undefined && !(options.clock instanceof TestClock)) {
      // A live Clock here would make every completion stamp real time, which is
      // the thing a deterministic scheduler exists to not do.
      panic("ReplayScheduler.make clock option must be a TestClock");
    }
    if (options.journal !== undefined && !Array.isArray(options.journal)) {
      panic("ReplayScheduler.make journal option must be an array of journal rows");
    }
    return new ReplayScheduler(
      options.clock,
      options.journal === undefined ? undefined : options.journal.map(checkJournalRow),
    );
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

  /**
   * The journal this run recorded, one row per scheduler operation, ready to be
   * handed straight back to `make({ journal })`.
   *
   * Deliberately NOT called "the completion order this run observed". Half of
   * these rows come from an order-independent operation and have no completion
   * order to report; see {@link JournalRow}. Recording a run and replaying that
   * exact recording against the same body is the round trip this getter and
   * {@link ReplaySchedulerOptions.journal} jointly promise, and it is a
   * property test rather than an example in `scheduler.test.ts`.
   */
  get journal(): readonly JournalRow[] {
    return Object.freeze([...this.#recorded]);
  }

  /**
   * Operations that found no journal row and were therefore dispatched live.
   *
   * `durable-execution.mdx` §Replay requires this — "the first request with no
   * journal entry MUST be dispatched" — because that is how a resumed execution
   * makes progress past the prefix it already recorded. So exhaustion is NOT an
   * error here, unlike every other refusal in this class.
   *
   * It used to be *invisible*, which was the real defect: a replay whose
   * positional cursor ran off the end silently resumed making live scheduling
   * decisions, and the run was indistinguishable from one given no journal at
   * all. Legitimate policy, unobservable execution. This counter is the
   * observation, on the same footing as {@link unticketed}.
   *
   * A journal recorded from a COMPLETE run is total for that run's program, so
   * a record-then-replay round trip must leave this at zero; a non-zero reading
   * there means the journal did not cover the body that produced it.
   */
  get dispatchedLive(): number {
    return this.#dispatchedLive;
  }

  /** What replay did with the journal it was given. */
  get replay(): ReplayAudit {
    return Object.freeze({
      rows: this.#journal?.size ?? 0,
      replayed: this.#replayed,
      dispatchedLive: this.#dispatchedLive,
    });
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

  /**
   * @param site The operation's site identity, defaulting to the operation's
   * own name.
   *
   * The default is honest but coarse, and the coarseness is worth stating.
   * `durable-execution.mdx` §Journal Identity requires the site identity to be
   * "content-addressed from the compiler's Effect Manifest", and nothing in
   * this tree can produce one yet. Under the default, every `firstReady` call
   * site in a body shares the site `"firstReady"` and is distinguished only by
   * its occurrence index — which is the same discriminating power a positional
   * cursor had, so the default loses nothing that was there before. What it
   * gains is that the *key* is now `(site, occurrence)`: a caller that CAN name
   * its site gets the spec's keying with no further change here, and two
   * requests at different sites may complete in either order and still
   * converge, which a shared stream could not express.
   */
  async firstReady<T>(contenders: Iterable<Contender<T>>, site = "firstReady"): Promise<T> {
    const entries = this.#account(contenders, "ReplayScheduler.firstReady");
    if (entries.length === 0) panic("ReplayScheduler.firstReady requires at least one contender");
    const { row, occurrence } = this.#open("firstReady", site, entries, "ReplayScheduler.firstReady");

    if (row !== undefined) {
      const expected = row.winner!;
      const where = `at ${site} occurrence ${occurrence}`;
      if (expected.index < 0) {
        // The recorded run answered with an untracked contender, so the journal
        // names no submission that any run could offer again.
        panic(
          `ReplayScheduler.firstReady diverged ${where}: the journal's winner is an unticketed submission, which no run can reproduce`,
        );
      }
      const position = entries.findIndex((entry) =>
        entry.ticket !== undefined && entry.ticket.index === expected.index && entry.ticket.site === expected.site
      );
      if (position < 0) {
        // Refuses rather than degrades. Falling back to arrival order here is
        // precisely the silent un-journaling this class exists to prevent.
        panic(
          `ReplayScheduler.firstReady diverged ${where}: the journal expects submission ${expected.index} at ${expected.site}, which this run did not offer`,
        );
      }
      const winner = await Promise.resolve(entries[position]!.work);
      this.#replayed += 1;
      this.#record("firstReady", site, occurrence, entries, entries[position]!);
      return winner;
    }

    const { position, value } = await Promise.race(entries.map(tagged));
    this.#record("firstReady", site, occurrence, entries, entries[position]!);
    return value;
  }

  /** @param site As {@link ReplayScheduler.firstReady}, defaulting to `"allReady"`. */
  async allReady<T>(contenders: Iterable<Contender<T>>, site = "allReady"): Promise<readonly T[]> {
    const entries = this.#account(contenders, "ReplayScheduler.allReady");
    // Order-independent by construction: the answer is in SUBMISSION order, so
    // no ARRIVAL-order check is applied and none is recorded — there is nothing
    // to record, and the previous version's sorted rows said so by being a
    // tautology. `#open` still verifies the offered set, which is a real fact
    // about the body and the one §Divergence asks for.
    const { row, occurrence } = this.#open("allReady", site, entries, "ReplayScheduler.allReady");
    const values = await Promise.all(entries.map((entry) => Promise.resolve(entry.work)));
    if (row !== undefined) this.#replayed += 1;
    this.#record("allReady", site, occurrence, entries);
    return values;
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

  /**
   * Assign this operation's occurrence index and find the row that keys to it,
   * verifying everything a row asserts about the body that is not the winner.
   */
  #open<T>(
    op: JournalOp,
    site: string,
    entries: readonly Normalized<T>[],
    caller: string,
  ): { readonly row: JournalRow | undefined; readonly occurrence: number } {
    if (typeof site !== "string" || site.length === 0) panic(`${caller} requires a non-empty site`);
    const occurrence = this.#occurrences.get(site) ?? 0;
    this.#occurrences.set(site, occurrence + 1);
    if (this.#journal === undefined) return { row: undefined, occurrence };

    const row = this.#journal.get(rowKey(site, occurrence));
    if (row === undefined) {
      // Not a failure: §Replay says the first request with no journal entry is
      // dispatched, which is how a resumed execution gets past its recorded
      // prefix. It is COUNTED, because doing it silently was the defect.
      this.#dispatchedLive += 1;
      return { row: undefined, occurrence };
    }
    const where = `at ${site} occurrence ${occurrence}`;
    if (row.op !== op) {
      panic(`${caller} diverged ${where}: the journal records ${row.op} there, not ${op}`);
    }
    const offered = entries.map(keyOf);
    if (!sameKeys(row.offered, offered)) {
      panic(
        `${caller} diverged ${where}: the journal records submissions [${describeKeys(row.offered)}] ` +
          `but this run offered [${describeKeys(offered)}]`,
      );
    }
    return { row, occurrence };
  }

  #record<T>(
    op: JournalOp,
    site: string,
    occurrence: number,
    entries: readonly Normalized<T>[],
    winner?: Normalized<T>,
  ): void {
    const at = this.#clock?.monotonic();
    this.#recorded.push(Object.freeze({
      op,
      site,
      occurrence,
      offered: Object.freeze(entries.map(keyOf)),
      ...(winner === undefined ? {} : { winner: keyOf(winner) }),
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
 * This IS what `TestPlatform.make` calls now; the wiring landed. Every
 * `TestPlatform`-based test therefore has a `ReplayScheduler` on
 * `platform.scheduler` whose `unticketed` counter can be read directly — which
 * is the whole verification criterion for the scheduler step.
 */
export function testScheduler(bundle: { readonly clock: Clock }, journal?: readonly JournalRow[]): ReplayScheduler {
  if (typeof bundle !== "object" || bundle === null) panic("testScheduler requires a platform bundle");
  if (!(bundle.clock instanceof TestClock)) panic("testScheduler requires a bundle carrying a TestClock");
  return ReplayScheduler.make(journal === undefined ? { clock: bundle.clock } : { clock: bundle.clock, journal });
}

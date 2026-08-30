/**
 * The replay driver.
 *
 * A durable body under the effect-request convention is a generator that yields
 * requests and is resumed with their answers. This module drives one such body
 * against a {@link DurableStore}: each `perform` becomes a fenced claim on a
 * node keyed by the request's journal key, an already-committed node answers
 * from the store WITHOUT re-invoking the effect, and an uncommitted one is
 * dispatched live and committed inside the store's existing transaction.
 *
 * It is **off by default** and reaches nothing on the Plan path. See
 * {@link ReplayDriverMode}.
 *
 * ## The journal key
 *
 * `specification/durable-execution.mdx` §Journal Identity: "A journal entry's
 * key MUST be `(siteIdentity, occurrenceIndex)`. The site identity MUST be
 * content-addressed from the compiler's Effect Manifest. The occurrence index
 * MUST be assigned at **submission** ... never at completion, and never as a
 * bare execution ordinal."
 *
 * {@link journalKey} spells that pair as one string, because `durable_nodes`
 * keys a row by `(execution_id, node_id)` and the pair has to fit the second
 * column without moving a durable primary key. `#` is the separator because no
 * node id in the tree contains one: the compiler mints `src-<24 hex>`
 * (`site-id.ts`), fan-out and loop children are `fan-<digest>` / `loop-<digest>`
 * (`store.ts`), and `::child::` is an *execution* id namespace. So a key is
 * unambiguous against every id the Plan path already writes, which is what lets
 * the two live in one table during the migration.
 *
 * ## How this reconciles with `concurrency/scheduler.ts`
 *
 * The scheduler reached the same keying first and this module reuses its
 * conclusions rather than inventing a second set:
 *
 * - **A row records one operation, not one completion.** Here a row is one
 *   `durable_nodes` row per request site occurrence. It is written at *claim*
 *   (`attempt_started`) and completed at commit, so a request that was
 *   dispatched but never finished still has a row — which is exactly what makes
 *   resumption after a crash between the two possible.
 * - **Keyed, never a positional cursor.** `ReplayScheduler` keys its journal by
 *   `(site, occurrence)` in a map because "a positional cursor cannot tell
 *   'this request has no journal entry' from 'the stream is misaligned'". The
 *   store gives that for free: a claim either finds a terminal row (replay) or
 *   does not (dispatch). The *positional* reading is used here only for the
 *   divergence check, where misalignment is the thing being detected.
 * - **Exhaustion must not silently degrade.** §Replay requires the first
 *   request with no journal entry to be dispatched, so running off the end is
 *   policy rather than error — but `ReplayScheduler` records why it was a defect
 *   for that to be *invisible*, and exposes `dispatchedLive`. {@link ReplayAudit}
 *   carries the same counter for the same reason.
 *
 * One difference is real and is stated rather than papered over. The occurrence
 * index here is **per site**, matching `JournalRow.occurrence` ("which occurrence
 * of `site` this is") and `site-id.ts`'s "dispatch occurrence index". The
 * counter in `runtime/effect.ts` is per *execution* — `Execution.occurrence`, a
 * single monotonic ordinal — which is closer to the scheduler's `Ticket.index`
 * than to its `occurrence`. Both produce a unique key when paired with a site,
 * so neither is unsound, but they are not the same quantity and a request that
 * arrives already carrying one is refused (see {@link ReplayDriver.run}) rather
 * than silently re-keyed under the other.
 */

import { DurableExecutionCancelled } from "./errors.ts"
import type { JsonValue } from "./ir.ts"
import type { PinnedDeployment } from "./migration.ts"
import type { AnyRequest, RequestKey, RequestKind, Resumable } from "../runtime/effect.ts"
import type { DurableStore, JournalEvent, StoredNodeExit } from "./store.ts"

/**
 * Whether the replay driver may run at all.
 *
 * Additive and reversible, exactly like `CompileOptions.effectLowering`: the
 * default is the shipped path and the new path is unreachable until a caller
 * names it. Nothing in the Plan pipeline reads this — the gate is on
 * constructing a driver, so an executor built without it cannot reach a single
 * line of this file.
 */
export type ReplayDriverMode = "off" | "on"

/** The default. The replay driver does not run unless a caller asks for it. */
export const REPLAY_DRIVER_DEFAULT: ReplayDriverMode = "off"

/**
 * `(siteIdentity, occurrenceIndex)` as one `durable_nodes.node_id`.
 *
 * @param site Content-addressed site identity; `site-id.ts`'s `effectSiteId`.
 * @param occurrence Dispatch occurrence index for that site, from zero.
 */
export const journalKey = (site: string, occurrence: number): string => {
  if (typeof site !== "string" || site.length === 0) {
    throw new TypeError("A journal key requires a non-empty site identity")
  }
  if (site.includes(JOURNAL_KEY_SEPARATOR)) {
    throw new TypeError(`A site identity may not contain ${JOURNAL_KEY_SEPARATOR}: ${site}`)
  }
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
    throw new TypeError("A journal key requires a non-negative safe integer occurrence index")
  }
  return `${site}${JOURNAL_KEY_SEPARATOR}${occurrence}`
}

const JOURNAL_KEY_SEPARATOR = "#"

/** Whether `nodeId` has the shape {@link journalKey} mints. */
export const isJournalKey = (nodeId: string): boolean => /^[^#]+#(?:0|[1-9][0-9]*)$/.test(nodeId)

/**
 * §Divergence: "the runtime MUST report a divergence naming the offending
 * source site, MUST fail the attempt, MUST NOT commit, and MUST abandon the
 * execution rather than record a terminal outcome for it."
 *
 * Raising this is the "fail the attempt" half. Nothing in this module records a
 * terminal outcome after raising it, and the claim that discovered the
 * divergence is left un-committed, which is the "MUST NOT commit" half.
 */
export class ReplayDivergenceError extends Error {
  constructor(
    readonly executionId: string,
    /** The site the divergence is attributed to, per §Divergence. */
    readonly site: string,
    message: string
  ) {
    super(message)
    this.name = "ReplayDivergenceError"
  }
}

/**
 * What one driven body did with the journal it was given.
 *
 * Modelled on `ReplayScheduler`'s audit, and for the same reason: a replay that
 * quietly stops replaying and starts dispatching is legitimate policy and
 * unobservable execution, and only a counter separates the two.
 */
export interface ReplayAudit {
  /** Requests the body issued. */
  readonly requests: number
  /** Requests answered from an already-committed node, without re-invoking. */
  readonly replayed: number
  /** Requests that found no committed node and were therefore dispatched. */
  readonly dispatchedLive: number
  /** Journal entries the execution held when this run started. */
  readonly recorded: number
}

/**
 * Re-exported so a caller can name the capability-map key type without reaching
 * into `runtime/effect.ts`. It is that module's `RequestKey` unchanged: "a
 * nominal identity the compiler derives from source", compared by identity only.
 */
export type { RequestKey }

/** How a `perform` request is carried out when it is not already committed. */
export type PerformEffect = (request: DispatchedEffectRequest) => PromiseLike<JsonValue> | JsonValue

/** A request the driver has assigned an occurrence index and a journal key. */
export interface DispatchedEffectRequest {
  readonly kind: RequestKind
  readonly key: RequestKey
  readonly input: unknown
  readonly site: string
  /** Dispatch occurrence index for {@link site}, assigned by the driver. */
  readonly occurrence: number
  /** {@link journalKey} of `(site, occurrence)`. */
  readonly journalKey: string
}

export interface ReplayDriverOptions {
  readonly mode: ReplayDriverMode
  readonly store: DurableStore
  readonly executionId: string
  /** Lease owner, as `DurableExecutor.owner`. */
  readonly owner: string
  /** The deployment fence, forwarded to every store call that takes one. */
  readonly pinned?: PinnedDeployment
  readonly leaseMs?: number
  /** Absolute wall-clock bound on waiting for another owner's lease. */
  readonly deadline?: number
  /**
   * Capability instances a `get` request is answered from.
   *
   * Nothing here is journaled. The Effect Manifest partitions the capability row
   * into journaled and replayed halves by the codec predicate, and that
   * partition is not wired yet; until it is, a `get` is answered from the
   * deployment's own layer and an unprovided key is a refusal rather than a
   * live read.
   */
  readonly capabilities?: ReadonlyMap<RequestKey, unknown>
  readonly perform: PerformEffect
}

const DEFAULT_LEASE_MS = 30_000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The ordered journal keys an execution has already recorded, in the order they
 * were first claimed.
 *
 * `attempt_started` is emitted inside `claimNode`'s own `BEGIN IMMEDIATE`, so
 * this order is the recorded *submission* order and not a completion order —
 * which is what §Journal Identity asks for and what `scheduler.ts` records at
 * length was wrong to conflate. Reading it through `DurableStore.journal` also
 * means every entry has passed its per-event digest re-verification before it
 * can influence a replay decision.
 */
const recordedKeys = (journal: readonly JournalEvent[]): readonly string[] => {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const event of journal) {
    if (event.type !== "attempt_started") continue
    const nodeId = event.nodeId
    // Plan node ids and journal keys share one table for the duration of the
    // migration, so a Plan-driven node in the same execution is not this
    // driver's and must not shift its occurrence positions. When the Plan path
    // is gone every row is a journal key and this filter is a no-op.
    if (nodeId === null || !isJournalKey(nodeId) || seen.has(nodeId)) continue
    seen.add(nodeId)
    ordered.push(nodeId)
  }
  return ordered
}

/**
 * Drives one generator body against a store.
 *
 * Reused verbatim from the Plan engine rather than reimplemented: the claim /
 * fence / commit discipline is `claimNode` → `commitSuccess`, the lease-theft
 * safety is the store's fencing token, and a lost fence re-reads the winner
 * instead of assuming its own attempt won.
 */
export class ReplayDriver {
  readonly #store: DurableStore
  readonly #executionId: string
  readonly #owner: string
  readonly #pinned: PinnedDeployment | undefined
  readonly #leaseMs: number
  readonly #deadline: number
  readonly #capabilities: ReadonlyMap<RequestKey, unknown>
  readonly #perform: PerformEffect
  #occurrences = new Map<string, number>()
  #visited: string[] = []
  #recorded: readonly string[] = []
  #requests = 0
  #replayed = 0
  #dispatchedLive = 0

  constructor(options: ReplayDriverOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("ReplayDriver options must be a record")
    }
    if (options.mode !== "on") {
      // The gate. `REPLAY_DRIVER_DEFAULT` is `"off"`, and an executor that never
      // names the mode cannot construct one of these, so the default path does
      // not reach this file at all.
      throw new Error(
        "The replay driver is off; construct it with { mode: \"on\" } to opt in to the replay path"
      )
    }
    if (typeof options.executionId !== "string" || options.executionId.trim() === "") {
      throw new TypeError("ReplayDriver requires a non-empty execution id")
    }
    if (typeof options.owner !== "string" || options.owner.trim() === "") {
      throw new TypeError("ReplayDriver requires a non-empty lease owner")
    }
    if (typeof options.perform !== "function") {
      throw new TypeError("ReplayDriver requires a perform function")
    }
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new TypeError("ReplayDriver lease must be a positive safe integer")
    }
    this.#store = options.store
    this.#executionId = options.executionId
    this.#owner = options.owner
    this.#pinned = options.pinned
    this.#leaseMs = leaseMs
    this.#deadline = options.deadline ?? Number.MAX_SAFE_INTEGER
    this.#capabilities = options.capabilities ?? new Map()
    this.#perform = options.perform
  }

  get audit(): ReplayAudit {
    return Object.freeze({
      requests: this.#requests,
      replayed: this.#replayed,
      dispatchedLive: this.#dispatchedLive,
      recorded: this.#recorded.length
    })
  }

  /**
   * Run `body` to completion, answering every request it issues.
   *
   * The body re-runs from the top on every resumption — that is the whole
   * model, and it is why the answer to an already-committed request must come
   * from the store rather than from re-invoking the effect.
   */
  async run<A>(body: () => Resumable<A>): Promise<A> {
    if (typeof body !== "function") throw new TypeError("ReplayDriver.run requires a body function")
    // One `run` is one ATTEMPT. Occurrence indices, visited positions, and the
    // audit are all per-attempt: a body that re-runs from the top must re-mint
    // the same keys, which it cannot do from a counter the previous attempt
    // left behind. Only the store carries state between attempts.
    this.#occurrences = new Map()
    this.#visited = []
    this.#requests = 0
    this.#replayed = 0
    this.#dispatchedLive = 0
    this.#recorded = recordedKeys(this.#store.journal(this.#executionId))
    const generator = body()
    let mode: "next" | "throw" = "next"
    let carried: unknown
    let step = generator.next()
    while (!step.done) {
      const request = this.#dispatch(step.value)
      try {
        carried = await this.#answer(request)
        mode = "next"
      } catch (raised) {
        if (!isResumableFailure(raised)) {
          // A divergence, a defect, or a coordinator-level refusal. It unwinds
          // past the body: §Divergence requires the attempt to fail without a
          // terminal outcome, and a defect is not the body's to catch.
          //
          // §Abandonment: an abandoned computation MUST NOT be left holding a
          // resource. `return()` runs the body's `finally` blocks, but a `yield`
          // inside one leaves the generator suspended instead of completing, so
          // the unwind is checked rather than assumed — the same refusal
          // `runtime/effect.ts` makes, and it fails closed with the original
          // cause attached rather than replacing it.
          const unwound = generator.return(undefined as never)
          if (!unwound.done) {
            throw new Error(
              `Durable execution ${this.#executionId} issued an effect request at ${request.site} while its ` +
              `body was being abandoned`,
              { cause: raised }
            )
          }
          throw raised
        }
        carried = raised.failure
        mode = "throw"
      }
      step = mode === "next" ? generator.next(carried) : generator.throw(carried)
    }
    this.#assertJournalConsumed()
    return step.value
  }

  /**
   * §Effect Requests: the occurrence index is "assigned at dispatch". This is
   * that assignment, and it is the only one — a request that arrives already
   * carrying an index was dispatched by `runtime/effect.ts`'s per-execution
   * counter, which is a different quantity from the per-site index a journal
   * key is built from (see this module's header). Honouring it silently would
   * key the same site under two schemes across two runs and make the journal
   * unreproducible, so it is refused.
   */
  #dispatch(request: AnyRequest): DispatchedEffectRequest {
    if (typeof request !== "object" || request === null) {
      throw new TypeError(`ReplayDriver received ${String(request)} where an effect request was expected`)
    }
    if (request.occurrence !== undefined) {
      throw new Error(
        `Effect request at ${request.site} arrived already dispatched at occurrence ` +
        `${request.occurrence}; the replay driver assigns the per-site occurrence index a journal key is ` +
        `built from and cannot re-key one assigned under another scheme`
      )
    }
    const site = request.site
    if (typeof site !== "string" || site.length === 0) {
      throw new TypeError("An effect request reached the replay driver without a site identity")
    }
    const occurrence = this.#occurrences.get(site) ?? 0
    this.#occurrences.set(site, occurrence + 1)
    const key = journalKey(site, occurrence)
    this.#requests += 1
    // §Divergence, the first arm: "if the body issues a request whose site
    // identity does not match the journal entry at that occurrence index". The
    // positional read is the check, not the lookup.
    //
    // Only a JOURNALED request holds a journal position. A `get` is answered
    // from the deployment's own layer and writes no row (see
    // `ReplayDriverOptions.capabilities`), so counting it here would shift every
    // later position by one and report a divergence for a body that has none.
    if (request.kind === "perform") {
      const position = this.#visited.length
      const expected = this.#recorded[position]
      if (expected !== undefined && expected !== key) {
        throw new ReplayDivergenceError(
          this.#executionId,
          site,
          `Durable execution ${this.#executionId} diverged at journal position ${position}: the journal ` +
          `records ${expected} and the body issued ${key} at ${site}`
        )
      }
      this.#visited.push(key)
    }
    return Object.freeze({
      kind: request.kind,
      key: request.key,
      input: request.input,
      site,
      occurrence,
      journalKey: key
    })
  }

  /**
   * §Divergence, the second arm: "or completes while journal entries remain
   * unconsumed".
   */
  #assertJournalConsumed(): void {
    if (this.#visited.length >= this.#recorded.length) return
    const orphan = this.#recorded[this.#visited.length]!
    throw new ReplayDivergenceError(
      this.#executionId,
      orphan.slice(0, orphan.lastIndexOf(JOURNAL_KEY_SEPARATOR)),
      `Durable execution ${this.#executionId} completed with ${this.#recorded.length - this.#visited.length} ` +
      `journal entr${this.#recorded.length - this.#visited.length === 1 ? "y" : "ies"} unconsumed, ` +
      `starting at ${orphan}`
    )
  }

  async #answer(request: DispatchedEffectRequest): Promise<unknown> {
    switch (request.kind) {
      case "get":
        // Not journaled; see `ReplayDriverOptions.capabilities`.
        if (!this.#capabilities.has(request.key)) {
          throw new Error(
            `No capability was provided for a get request at ${request.site}`
          )
        }
        return this.#capabilities.get(request.key)
      case "abort":
        // `runHandled` refuses the same thing at the top of a program: an abort
        // is answered by the nearest enclosing frame handler, so one reaching
        // the driver means the body was emitted without one.
        throw new Error(
          `An abort request at ${request.site} reached the replay driver with no enclosing frame handler`
        )
      case "perform":
        return this.#performJournaled(request)
    }
  }

  async #performJournaled(request: DispatchedEffectRequest): Promise<JsonValue> {
    for (;;) {
      const claim = this.#store.claimNode(
        this.#executionId,
        request.journalKey,
        this.#owner,
        this.#leaseMs,
        Date.now(),
        this.#pinned,
        // The lazy row. A journal key is minted when the body reaches the site,
        // so no eager insert could have created it.
        { nodeKind: "action" }
      )
      if (claim.kind === "terminal") {
        this.#replayed += 1
        return answerFromExit(request, claim.exit)
      }
      if (claim.kind === "busy") {
        const now = Date.now()
        if (now >= this.#deadline) {
          throw new Error(
            `Durable execution ${this.#executionId} exceeded its deadline waiting for ${request.journalKey}`
          )
        }
        await delay(Math.min(25, Math.max(1, claim.leaseExpiresAt - now), Math.max(1, this.#deadline - now)))
        continue
      }
      this.#dispatchedLive += 1
      const value = await this.#perform(request)
      const committed = this.#store.commitSuccess(
        this.#executionId,
        request.journalKey,
        this.#owner,
        claim.fencingToken,
        value
      )
      if (committed) return value
      // The fence moved under this attempt, so it wrote nothing. Adopt whatever
      // the winner committed rather than assume this attempt's value — the same
      // rule `engine.ts` applies at every lost commit.
      const winner = this.#store.getNode(this.#executionId, request.journalKey).exit
      if (winner === undefined) continue
      this.#replayed += 1
      return answerFromExit(request, winner)
    }
  }
}

/**
 * A typed failure delivered back into the body at its suspension point.
 *
 * Distinguished from every other throw the driver can produce because only this
 * one is the body's to catch: a divergence, a defect, and a cancellation all
 * unwind past it.
 */
class ResumableFailure extends Error {
  constructor(readonly failure: unknown) {
    super("Durable effect failed with a typed failure")
    this.name = "ResumableFailure"
  }
}

const isResumableFailure = (value: unknown): value is ResumableFailure => value instanceof ResumableFailure

const answerFromExit = (request: DispatchedEffectRequest, exit: StoredNodeExit): JsonValue => {
  switch (exit.kind) {
    case "success":
      return exit.value
    case "failure":
      throw new ResumableFailure(exit.error)
    case "defect":
      throw new Error(
        `Durable effect at ${request.site} terminated with a defect: ${JSON.stringify(exit.defect)}`
      )
    case "skipped":
      throw new Error(`Durable effect at ${request.site} was skipped and has no answer`)
    case "cancelled":
      throw new DurableExecutionCancelled(exit.reason)
  }
}

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
 * The runtime and this driver share the same per-site submission convention.
 * A request forwarded through an inner delimiter retains its occurrence; the
 * driver validates it against the attempt's per-site cursor instead of minting
 * a second identity. Every replay starts a fresh execution scope.
 */

import { CoordinatorUnavailable, DurableActionDefect, DurableExecutionCancelled, DurableRequestMismatch } from "./errors.ts"
import type { JsonValue, WorkerExit } from "./ir.ts"
import type { PinnedDeployment } from "./migration.ts"
import { __vsExecutionScope, __vsIsDispatchedRequest, type AnyRequest, type DispatchedRequest, type RequestKey, type RequestKind, type Resumable, type StepGuard } from "../runtime/effect.ts"
import type { ClaimResult, DurableStore, JournalEvent, StoredNodeExit } from "./store.ts"

/**
 * Whether the replay driver may run at all.
 *
 * Direct driver clients must opt in. The signed executable BodyExecutor always
 * selects this driver; the compatibility Plan executor does not. This is not
 * an authored language flag or a compiler-lowering option.
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
export type PerformEffect = (request: DispatchedEffectRequest, attempt: ReplayAttempt) => PromiseLike<JsonValue> | JsonValue

export interface ReplayAttempt extends Omit<Extract<ClaimResult, { kind: "claimed" }>, "kind"> {
  readonly owner: string
  readonly signal: AbortSignal
  /** Schedule a fenced retry, then relinquish this attempt without resuming the body. */
  retry(exit: WorkerExit, retryAt: number): never
  /** Commit a non-recoverable worker defect under this attempt's fence. */
  fail(defect: Extract<WorkerExit, { kind: "defect" }>["defect"]): never
}

class RetryAttempt {}
class LostAttempt {}

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
  /** Compiler-owned attempt dispatcher, shared with its inner lexical handlers. */
  readonly dispatchRequest?: (request: AnyRequest) => DispatchedRequest
  readonly validateRequest?: (request: DispatchedEffectRequest) => void
  readonly decodeAnswer?: (request: DispatchedEffectRequest, answer: JsonValue) => unknown
  readonly afterCommit?: (request: DispatchedEffectRequest) => void | Promise<void>
  readonly signal?: AbortSignal
  readonly requestDigest?: (request: DispatchedEffectRequest) => string
  /** Coordinator-owned nodes suspend without a worker lease; omitted means Action. */
  readonly journalNode?: (request: DispatchedEffectRequest) =>
    { readonly kind: "action" } | { readonly kind: "timer"; readonly durationMs: number }
  readonly afterTimerScheduled?: (request: DispatchedEffectRequest, wakeAt: number) => void | Promise<void>
  readonly wakeupSweepMs?: number
  /** Optional atomic cache/node commit; it must return the actual committed answer. */
  readonly commitAnswer?: (request: DispatchedEffectRequest, claim: Extract<ClaimResult, { kind: "claimed" }>, answer: JsonValue) =>
    { readonly kind: "committed"; readonly value: JsonValue } | { readonly kind: "lost" }
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
    // A timer commits submission before waiting, not when it later becomes
    // eligible for a lease. Counting only attempts would lose a scheduled but
    // not-yet-due request from divergence checks after a process restart.
    if (event.type !== "attempt_started" && event.type !== "timer_scheduled") continue
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
  readonly #dispatchRequest: ReplayDriverOptions["dispatchRequest"]
  readonly #validateRequest: ReplayDriverOptions["validateRequest"]
  readonly #decodeAnswer: ReplayDriverOptions["decodeAnswer"]
  readonly #afterCommit: ReplayDriverOptions["afterCommit"]
  readonly #signal: ReplayDriverOptions["signal"]
  readonly #requestDigest: ReplayDriverOptions["requestDigest"]
  readonly #commitAnswer: ReplayDriverOptions["commitAnswer"]
  readonly #journalNode: ReplayDriverOptions["journalNode"]
  readonly #afterTimerScheduled: ReplayDriverOptions["afterTimerScheduled"]
  readonly #wakeupSweepMs: number
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
  #running = false

  constructor(options: ReplayDriverOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("ReplayDriver options must be a record")
    }
    this.#dispatchRequest = options.dispatchRequest
    this.#validateRequest = options.validateRequest
    this.#decodeAnswer = options.decodeAnswer
    this.#afterCommit = options.afterCommit
    this.#signal = options.signal
    this.#requestDigest = options.requestDigest
    this.#commitAnswer = options.commitAnswer
    this.#journalNode = options.journalNode
    this.#afterTimerScheduled = options.afterTimerScheduled
    this.#wakeupSweepMs = options.wakeupSweepMs ?? 250
    if (!Number.isSafeInteger(this.#wakeupSweepMs) || this.#wakeupSweepMs <= 0) {
      throw new TypeError("ReplayDriver wakeup sweep must be a positive safe integer")
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
  async run<A>(body: () => Resumable<A> | import("../runtime/effect.ts").AsyncResumable<A>): Promise<A> {
    if (typeof body !== "function") throw new TypeError("ReplayDriver.run requires a body function")
    if (this.#running) throw new Error("A replay driver cannot run overlapping attempts")
    this.#running = true
    // One `run` is one ATTEMPT. Occurrence indices, visited positions, and the
    // audit are all per-attempt: a body that re-runs from the top must re-mint
    // the same keys, which it cannot do from a counter the previous attempt
    // left behind. Only the store carries state between attempts.
    this.#occurrences = new Map()
    this.#visited = []
    this.#requests = 0
    this.#replayed = 0
    this.#dispatchedLive = 0
    const around = __vsExecutionScope()
    let generator: Resumable<A> | import("../runtime/effect.ts").AsyncResumable<A> | undefined
    let failed = false
    try {
      this.#recorded = recordedKeys(this.#store.journal(this.#executionId))
      this.#signal?.throwIfAborted()
      generator = around(body)
      let mode: "next" | "throw" = "next"
      let carried: unknown
      let step = await around(() => generator!.next())
      while (!step.done) {
        this.#signal?.throwIfAborted()
        // Dispatch itself may detect divergence. It belongs inside the same
        // abandonment boundary as a failed answer, not outside the try block.
        const request = this.#dispatch(step.value)
        try {
          if (request.kind === "perform") this.#validateRequest?.(request)
          const answer = await this.#answer(request)
          carried = request.kind === "perform" && this.#decodeAnswer
            ? this.#decodeAnswer(request, answer as JsonValue) : answer
          mode = "next"
        } catch (raised) {
          if (!isResumableFailure(raised)) throw raised
          carried = raised.failure
          mode = "throw"
        }
        step = await around(() => mode === "next" ? generator!.next(carried) : generator!.throw(carried))
      }
      this.#assertJournalConsumed()
      return step.value
    } catch (error) {
      failed = true
      throw error
    } finally {
      try {
        if (generator) await this.#unwind(generator, around)
      } catch (error) {
        // Preserve the coordinator's original divergence/defect identity. The
        // finalizer still drains every outer scope before this point.
        if (!failed) throw error
      } finally {
        this.#running = false
      }
    }
  }

  async #unwind<A>(generator: Resumable<A> | import("../runtime/effect.ts").AsyncResumable<A>, around: StepGuard): Promise<void> {
    let step = await around(() => generator.return(undefined as never))
    let refused: string | undefined
    while (!step.done) {
      const request = step.value
      if (request.kind === "get" && this.#capabilities.has(request.key)) {
        step = await around(() => generator.next(this.#capabilities.get(request.key)))
      } else {
        refused ??= request.site
        // A divergence must not dispatch or commit new effects during cleanup.
        // Keep returning until the outer finally/using scopes are closed.
        step = await around(() => generator.return(undefined as never))
      }
    }
    if (refused !== undefined) throw new Error(
      `Durable execution ${this.#executionId} issued an unanswered cleanup request at ${refused}`
    )
  }

  /**
   * Assign at submission, or validate an assignment preserved by an inner
   * frame. Forwarding must never renumber a request.
   */
  #dispatch(request: AnyRequest): DispatchedEffectRequest {
    if (this.#dispatchRequest) request = this.#dispatchRequest(request)
    if (typeof request !== "object" || request === null) {
      throw new TypeError(`ReplayDriver received ${String(request)} where an effect request was expected`)
    }
    if (request.kind !== "get" && request.kind !== "perform" && request.kind !== "abort") {
      throw new TypeError("ReplayDriver received an unknown effect request kind")
    }
    const site = request.site
    if (typeof site !== "string" || site.length === 0) {
      throw new TypeError("An effect request reached the replay driver without a site identity")
    }
    const minimum = this.#occurrences.get(site) ?? 0
    if (request.occurrence !== undefined && !__vsIsDispatchedRequest(request)) {
      throw new Error(`Effect request at ${site} arrived already dispatched at occurrence ${request.occurrence} without runtime dispatch identity`)
    }
    const occurrence = request.occurrence ?? minimum
    // The inner dispatcher owns identity. A lexical Layer can answer earlier
    // occurrences without forwarding them here, so arrival counts are not
    // dispatch counts. Preserve gaps, but never accept duplicates/backtracking
    // or malformed indices. Raw legacy bodies still get dense local indices.
    if (!Number.isSafeInteger(occurrence) || occurrence < minimum) {
      throw new Error(`Effect request at ${site} has invalid or repeated occurrence ${occurrence}; expected at least ${minimum}`)
    }
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
    const requestDigest = this.#requestDigest?.(request)
    const node = this.#journalNode?.(request) ?? { kind: "action" }
    if (node.kind !== "timer" && node.kind !== "action") throw new TypeError("Unknown durable journal node kind")
    if (node.kind === "timer") {
      this.#signal?.throwIfAborted()
      let scheduled: ReturnType<DurableStore["scheduleTimer"]>
      try {
        // A timer's duration must be pinned even for direct driver clients.
        if (requestDigest === undefined) throw new TypeError("Durable timer requests require a pinned request digest")
        scheduled = this.#store.scheduleTimer(this.#executionId, request.journalKey, node.durationMs,
          Date.now(), this.#pinned, { requestDigest })
      } catch (error) {
        if (error instanceof DurableRequestMismatch) throw new ReplayDivergenceError(this.#executionId, request.site, error.message)
        throw error
      }
      if (scheduled.kind === "terminal") {
        this.#replayed += 1
        return answerFromExit(request, scheduled.exit)
      }
      if (scheduled.newlyScheduled) await this.#afterTimerScheduled?.(request, scheduled.wakeAt)
    }
    for (;;) {
      this.#signal?.throwIfAborted()
      let claim: ClaimResult
      try { claim = this.#store.claimNode(
        this.#executionId,
        request.journalKey,
        this.#owner,
        this.#leaseMs,
        Date.now(),
        this.#pinned,
        // The lazy row. A journal key is minted when the body reaches the site,
        // so no eager insert could have created it.
        node.kind === "timer" ? undefined : { nodeKind: "action", ...(requestDigest === undefined ? {} : { requestDigest }) }
      ) } catch (error) {
        if (error instanceof DurableRequestMismatch) throw new ReplayDivergenceError(this.#executionId, request.site, error.message)
        throw error
      }
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
        if (node.kind === "timer") {
          await this.#store.wakeups.wait(this.#executionId,
            Math.min(claim.leaseExpiresAt, this.#deadline, now + this.#wakeupSweepMs))
        } else {
          await delay(Math.min(25, Math.max(1, claim.leaseExpiresAt - now), Math.max(1, this.#deadline - now)))
        }
        continue
      }
      this.#dispatchedLive += 1
      let value: JsonValue
      try {
        value = await this.#invoke(request, claim)
      } catch (error) {
        if (error instanceof RetryAttempt || error instanceof LostAttempt) continue
        throw error
      }
      this.#signal?.throwIfAborted()
      // A malformed live exit must never become committed replay evidence.
      // The same pure codec is applied again when the answer enters the body.
      this.#decodeAnswer?.(request, value)
      const outcome = this.#commitAnswer ? this.#commitAnswer(request, claim, value) : this.#store.commitSuccess(
        this.#executionId,
        request.journalKey,
        this.#owner,
        claim.fencingToken,
        value
      ) ? { kind: "committed" as const, value } : { kind: "lost" as const }
      if (outcome.kind === "committed") {
        await this.#afterCommit?.(request)
        return outcome.value
      }
      // The fence moved under this attempt, so it wrote nothing. Adopt whatever
      // the winner committed rather than assume this attempt's value — the same
      // rule `engine.ts` applies at every lost commit.
      const winner = this.#store.getNode(this.#executionId, request.journalKey).exit
      if (winner === undefined) continue
      this.#replayed += 1
      return answerFromExit(request, winner)
    }
  }

  async #invoke(request: DispatchedEffectRequest, claim: Extract<ClaimResult, { kind: "claimed" }>): Promise<JsonValue> {
    this.#signal?.throwIfAborted()
    if (Date.now() >= this.#deadline) throw new Error("Durable execution deadline exceeded before dispatch")
    const controller = new AbortController()
    const cancelled = (): void => controller.abort(this.#signal?.reason)
    if (this.#signal?.aborted) cancelled()
    else this.#signal?.addEventListener("abort", cancelled, { once: true })
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    const heartbeat = setInterval(() => {
      try {
        if (!this.#store.heartbeat(this.#executionId, request.journalKey, this.#owner, claim.fencingToken,
          Date.now() + this.#leaseMs)) controller.abort(new LostAttempt())
      } catch (error) { controller.abort(new CoordinatorUnavailable("lease renewal", error)) }
    }, Math.max(1, Math.floor(this.#leaseMs / 3)))
    heartbeat.unref?.()
    const deadline = (): void => {
      const remaining = this.#deadline - Date.now()
      if (remaining <= 0) controller.abort(new Error("Durable execution deadline exceeded during dispatch"))
      else deadlineTimer = setTimeout(deadline, Math.min(2_147_483_647, remaining))
    }
    deadline()
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason)
      if (controller.signal.aborted) onAbort()
      else controller.signal.addEventListener("abort", onAbort, { once: true })
    })
    try {
      const attempt: ReplayAttempt = Object.freeze({ ...claim, owner: this.#owner, signal: controller.signal,
        fail: (defect: Extract<WorkerExit, { kind: "defect" }>["defect"]): never => {
          controller.signal.throwIfAborted()
          if (this.#store.commitFailure(this.#executionId, request.journalKey, this.#owner, claim.fencingToken,
            { kind: "defect", defect })) throw new DurableActionDefect(request.journalKey, defect)
          throw new LostAttempt()
        },
        retry: (exit: WorkerExit, retryAt: number): never => {
          controller.signal.throwIfAborted()
          if (!Number.isSafeInteger(retryAt) || retryAt < 0) throw new TypeError("invalid durable retry timestamp")
          this.#store.scheduleRetry(this.#executionId, request.journalKey, this.#owner, claim.fencingToken, exit, retryAt)
          throw new RetryAttempt()
        },
      })
      return await Promise.race([Promise.resolve().then(() => {
        // Cancellation can arrive between the synchronous claim and this
        // microtask. Racing the Promise alone still starts the abandoned work.
        controller.signal.throwIfAborted()
        return this.#perform(request, attempt)
      }), aborted])
    } finally {
      clearInterval(heartbeat)
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
      controller.signal.removeEventListener("abort", onAbort)
      this.#signal?.removeEventListener("abort", cancelled)
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
      throw new DurableActionDefect(request.journalKey, exit.defect)
    case "skipped":
      throw new Error(`Durable effect at ${request.site} was skipped and has no answer`)
    case "cancelled":
      throw new DurableExecutionCancelled(exit.reason)
  }
}

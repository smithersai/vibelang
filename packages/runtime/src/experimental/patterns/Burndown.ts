/**
 * A burndown: work a backlog down to nothing. Each round rediscovers the
 * backlog, selects the items that are ours, claims them, works each one,
 * lands each result as its work finishes, and releases every claim, at a
 * concurrency and a capacity the burndown owns. Any backlog with a stable
 * `id` per item works: issues, tickets, queue messages.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import { concurrencyRefusal } from "./internal.js"
import { PatternError } from "./PatternError.js"

/**
 * One backlog item. `id` keys its row, its claim and its execution id, so it
 * is a nonblank string, unique within one discovery.
 *
 * @category models
 * @since 0.0.13
 */
export interface Item {
  readonly id: string
}

/**
 * What happened to one item. `landed`: the work succeeded and landed.
 * `held`: another owner holds the claim. `failed`: a claim, work, landing or
 * release failure. `skipped`: selection said the item is not ours this round,
 * or failed to decide. `requeued`: the work was interrupted without a
 * recorded cancel, so a later round works the item again.
 *
 * @category models
 * @since 0.0.13
 */
export type Status = "landed" | "held" | "failed" | "skipped" | "requeued"

/**
 * One outcome row.
 *
 * @category models
 * @since 0.0.13
 */
export interface Row {
  readonly id: string
  readonly status: Status
  readonly detail: string
}

/**
 * Why a burndown stopped. `drained`: a round launched, deferred and
 * requeued nothing. `max_rounds`: the round budget ran out first.
 *
 * @category models
 * @since 0.0.13
 */
export type Stopped = "drained" | "max_rounds"

/**
 * What a burndown settles with. `rows` holds one row per item it touched, in
 * first-seen order; a `landed`, `held` or `failed` row is final, and a
 * `skipped` or `requeued` row is the latest round's. `rounds` counts the
 * rounds opened, waits included.
 *
 * @category models
 * @since 0.0.13
 */
export interface Result {
  readonly rows: ReadonlyArray<Row>
  readonly rounds: number
  readonly stopped: Stopped
}

/**
 * What one round reports. `launched` counts the items the round claimed or
 * tried to claim; `deferred` counts the items that were ours but got no slot.
 *
 * @category models
 * @since 0.0.13
 */
export interface RoundResult {
  readonly rows: ReadonlyArray<Row>
  readonly launched: number
  readonly deferred: number
}

/**
 * What a capacity stage answers. `Available` launches at most `slots` items.
 * `WaitUntil` holds the burndown until the epoch-millisecond instant `at`.
 * `Exhausted` means only an operator can make room.
 *
 * @category models
 * @since 0.0.13
 */
export type Capacity =
  | { readonly _tag: "Available"; readonly slots: number }
  | { readonly _tag: "WaitUntil"; readonly at: number }
  | { readonly _tag: "Exhausted"; readonly detail: string }

/**
 * `slots` items may launch.
 *
 * @throws never
 * @category constructors
 * @since 0.0.13
 */
export const available = (slots: number): Capacity => ({ _tag: "Available", slots })

/**
 * Nothing may launch before the epoch-millisecond instant `at`.
 *
 * @throws never
 * @category constructors
 * @since 0.0.13
 */
export const waitUntil = (at: number): Capacity => ({ _tag: "WaitUntil", at })

/**
 * Nothing may launch until an operator makes room.
 *
 * @throws never
 * @category constructors
 * @since 0.0.13
 */
export const exhausted = (detail: string): Capacity => ({ _tag: "Exhausted", detail })

/**
 * A selection decision. Only the exact `Ours` value launches an item; an
 * answered `Skip` is a policy decision.
 *
 * @category models
 * @since 0.0.13
 */
export type Selection = { readonly _tag: "Ours" } | { readonly _tag: "Skip"; readonly detail: string }

/**
 * The item is ours: claim and work it.
 *
 * @category constructors
 * @since 0.0.13
 */
export const ours: Selection = Object.freeze({ _tag: "Ours" })

/**
 * The item is not ours this round, for the stated reason.
 *
 * @throws never
 * @category constructors
 * @since 0.0.13
 */
export const skip = (detail: string): Selection => ({ _tag: "Skip", detail })

/**
 * The failure a claim raises when another owner holds the item. A held item
 * is reported `held`, never retried, and never released.
 *
 * @category errors
 * @since 0.0.13
 */
export class Held extends Data.TaggedError("Burndown/Held")<{ readonly message: string }> {}

/**
 * The failure that stops a round and releases its open claims. Only a typed
 * `Stop` stops a round; a defect settles only its own item.
 *
 * @category errors
 * @since 0.0.13
 */
export class Stop extends Data.TaggedError("Burndown/Stop")<{ readonly message: string }> {}

/**
 * What one round reads. `settled` lists ids an earlier round already settled;
 * they are left alone. `slots`, when present, caps how many items launch
 * before the round's `capacity` is asked.
 *
 * @category models
 * @since 0.0.13
 */
export interface RoundInput<I, It extends Item> {
  readonly input: I
  readonly round: number
  readonly items: ReadonlyArray<It>
  readonly settled?: ReadonlyArray<string> | undefined
  readonly slots?: number | undefined
}

/**
 * What every stage of a round receives.
 *
 * @category models
 * @since 0.0.13
 */
export interface ItemArgs<I, It extends Item> {
  readonly input: I
  readonly item: It
  readonly round: number
}

/**
 * The stages of one round. `work` receives the execution id
 * `${key}/${item.id}`. `select` defaults to {@link ours}. `claim` may fail
 * with {@link Held}. `land`, when present, starts items in the order work
 * finished, at most `landConcurrency` at a time (default 1); without it a
 * worked item counts as landed. `release` runs once for every item whose
 * claim succeeded, with its final status and detail. `detail` renders a
 * landed item's detail. `capacity` is asked each time a slot frees and an
 * item that is ours waits beyond `slots`. `cancelled` is asked about an item
 * whose work was interrupted; only `true` settles it `failed`.
 *
 * @category models
 * @since 0.0.13
 */
export interface RoundOptions<I, It extends Item, W, E, R, L = unknown> {
  readonly key: string
  readonly concurrency: number
  readonly select?: ((args: ItemArgs<I, It>) => Effect.Effect<Selection, E, R>) | undefined
  readonly claim: (args: ItemArgs<I, It>) => Effect.Effect<unknown, E | Held, R>
  readonly work: (args: ItemArgs<I, It> & { readonly executionId: string }) => Effect.Effect<W, E, R>
  readonly land?: ((args: ItemArgs<I, It> & { readonly output: W }) => Effect.Effect<L, E, R>) | undefined
  readonly landConcurrency?: number | undefined
  readonly release: (
    args: ItemArgs<I, It> & { readonly status: Status; readonly detail: string }
  ) => Effect.Effect<unknown, E, R>
  readonly detail?: ((output: W, landing: L | undefined) => string) | undefined
  readonly cancelled?:
    | ((args: ItemArgs<I, It> & { readonly executionId: string }) => Effect.Effect<boolean, E, R>)
    | undefined
  readonly capacity?:
    | ((args: { readonly input: I; readonly round: number }) => Effect.Effect<Capacity, E, R>)
    | undefined
}

const bound = (value: number): boolean => Number.isSafeInteger(value) && value >= 1

// The text of a failure: its own `message` when it has one, otherwise its
// string form.
const detailOf = (error: unknown): string => {
  try {
    return typeof error === "object" && error !== null &&
        typeof (error as { readonly message?: unknown }).message === "string"
      ? (error as { readonly message: string }).message
      : String(error)
  } catch {
    return "unrenderable failure"
  }
}

const ownTag = (value: unknown, tag: string): boolean =>
  typeof value === "object" && value !== null && Object.hasOwn(value, "_tag") &&
  (value as { readonly _tag: unknown })._tag === tag

const isStop = (value: unknown): value is Stop => ownTag(value, "Burndown/Stop")

const isCapacity = (value: unknown): value is Capacity => {
  if (typeof value !== "object" || value === null) return false
  const answer = value as { readonly _tag?: unknown; readonly slots?: unknown; readonly at?: unknown; readonly detail?: unknown }
  if (answer._tag === "Available") {
    return typeof answer.slots === "number" && Number.isSafeInteger(answer.slots) && answer.slots >= 1
  }
  if (answer._tag === "WaitUntil") return typeof answer.at === "number" && Number.isFinite(answer.at)
  return answer._tag === "Exhausted" && typeof answer.detail === "string"
}

// What one selection decided: an answered selection, or an `Erred` skip when
// the stage failed or answered outside the contract.
type Selected = Selection | { readonly _tag: "Erred"; readonly detail: string }

const selectionOf = (value: unknown): Selected => {
  if (ownTag(value, "Ours")) return ours
  if (ownTag(value, "Skip") && typeof (value as { readonly detail?: unknown }).detail === "string") {
    return skip((value as { readonly detail: string }).detail)
  }
  return { _tag: "Erred", detail: "selection did not answer ours" }
}

const refusal = (message: string): PatternError => new PatternError({ code: "invalid_input", message })

const roundRefusal = (
  input: { readonly round: unknown; readonly items: unknown; readonly settled?: unknown; readonly slots?: unknown },
  key: unknown,
  concurrency: number,
  landConcurrency: unknown
): PatternError | undefined => {
  if (typeof key !== "string" || key.trim().length === 0) {
    return new PatternError({ code: "invalid_decorator", message: "Burndown key must be a nonblank string" })
  }
  const width = concurrencyRefusal("Burndown", concurrency)
  if (width !== undefined) return width
  if (landConcurrency !== undefined && (typeof landConcurrency !== "number" || !bound(landConcurrency))) {
    return new PatternError({ code: "invalid_decorator", message: "Burndown landConcurrency must be a positive safe integer" })
  }
  if (typeof input.round !== "number" || !Number.isSafeInteger(input.round) || input.round < 0) {
    return refusal("Burndown round must be a non-negative safe integer")
  }
  if (input.slots !== undefined && (typeof input.slots !== "number" || !bound(input.slots))) {
    return refusal("Burndown slots must be a positive safe integer")
  }
  if (input.settled !== undefined && !Array.isArray(input.settled)) {
    return refusal("Burndown settled must be an array of item ids")
  }
  if (!Array.isArray(input.items)) return refusal("Burndown items must be an array")
  const ids = new Set<string>()
  for (const item of input.items as ReadonlyArray<unknown>) {
    const id = typeof item === "object" && item !== null && Object.hasOwn(item, "id")
      ? (item as { readonly id: unknown }).id
      : undefined
    if (typeof id !== "string" || id.trim().length === 0) return refusal("Burndown items must each have a nonblank string id")
    if (ids.has(id)) return refusal(`Burndown item ids must be unique, "${id.slice(0, 64)}" (length ${id.length}) repeats`)
    ids.add(id)
  }
  return undefined
}

interface Card<It> {
  readonly id: string
  readonly item: It
}

type Settled = { readonly _tag: "Settled"; readonly status: Status; readonly detail: string }
type Attempt<W> = Settled | { readonly _tag: "Worked"; readonly output: W }
type Observed<A> = { readonly _tag: "Value"; readonly value: A } | Settled

/**
 * Runs one round. Items in `settled` are left alone. `select` runs for the
 * rest at `concurrency`; a skipped item, or one whose selection failed, gets
 * a `skipped` row. When no item is ours and none was requeued but a
 * selection failed, the round fails with {@link Stop} before any claim. Of
 * the items that are ours, the first `slots` launch in discovery order, and
 * a freed slot admits the next one while `capacity` answers `Available` with
 * more slots than the work in flight; the rest are `deferred`.
 *
 * Each launched item is claimed, then worked, at most `concurrency` at a
 * time. A `Held` claim settles the item `held`; any other failure, or a
 * defect, settles only that item `failed` and never cancels the items beside
 * it. A worked item is landed as soon as its work finishes. Every claimed
 * item is released as soon as it settles; a release failure is appended to
 * the row's detail. A typed {@link Stop} stops the round and releases every
 * open claim `failed`. When the round is interrupted, each open claim is
 * released `failed` if `cancelled` reports a recorded cancel, and otherwise
 * `requeued`. Rows keep discovery order.
 *
 * Fails with `PatternError` before any stage runs when `key` is blank,
 * `concurrency`, `landConcurrency` or `slots` is not a positive safe integer,
 * `round` is not a non-negative safe integer, or an item lacks a nonblank
 * string id or repeats one.
 *
 * @category combinators
 * @since 0.0.13
 */
export const round = <I, It extends Item, W, E = never, R = never, L = unknown>(
  input: RoundInput<I, It>,
  options: RoundOptions<I, It, W, E, R, L>
): Effect.Effect<RoundResult, PatternError | Stop, R> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the items or the options in between must not reach it. Each item's id is
  // read here; the record itself stays the caller's.
  const { cancelled, capacity, claim, concurrency, detail, key, land, release, select, work } = options
  const landers = options.landConcurrency ?? 1
  const invalid = roundRefusal(input, key, concurrency, options.landConcurrency)
  if (invalid !== undefined) return Effect.fail(invalid)
  const value = input.input
  const index = input.round
  const slots = input.slots
  const settled = new Set(input.settled ?? [])
  const cards: ReadonlyArray<Card<It>> = input.items.map((item) => ({ id: item.id, item }))
  const args = (card: Card<It>): ItemArgs<I, It> => ({ input: value, item: card.item, round: index })
  return Effect.gen(function*() {
    const failure = (stage: string, cause: Cause.Cause<unknown>): Effect.Effect<Settled, Stop> => {
      const defect = cause.reasons.find(Cause.isDieReason)
      const error = cause.reasons.find(Cause.isFailReason)?.error
      if (defect === undefined && isStop(error)) return Effect.fail(error)
      const reported = defect === undefined ? error ?? Cause.squash(cause) : defect.defect
      return Effect.succeed({ _tag: "Settled", status: "failed", detail: `${stage}: ${detailOf(reported)}` })
    }
    const observe = <A>(stage: string, run: () => Effect.Effect<A, unknown, R>): Effect.Effect<Observed<A>, Stop, R> =>
      Effect.suspend(run).pipe(Effect.matchCauseEffect({
        onSuccess: (answer) => Effect.succeed<Observed<A>>({ _tag: "Value", value: answer }),
        onFailure: (cause) => failure(stage, cause)
      }))
    const rows = new Map<string, Row>()
    const outcomeRow = (card: Card<It>, status: Status, text: string): Row => ({ id: card.id, status, detail: text })
    const fresh = cards.filter((card) => !settled.has(card.id))
    const selections = yield* Effect.forEach(
      fresh,
      (card) =>
        observe("select", () =>
          (select === undefined ? Effect.succeed<Selected>(ours) : select(args(card))).pipe(
            Effect.map(selectionOf),
            Effect.catch((error: E) =>
              isStop(error)
                ? Effect.fail(error)
                : Effect.succeed<Selected>({ _tag: "Erred", detail: `select failed: ${detailOf(error)}` })
            )
          )).pipe(Effect.map((selection) => ({ card, selection }))),
      { concurrency }
    )
    const mine: Array<Card<It>> = []
    const erred: Array<string> = []
    for (const { card, selection } of selections) {
      if (selection._tag === "Settled") {
        rows.set(card.id, outcomeRow(card, selection.status, selection.detail))
        erred.push(`${card.id}: ${selection.detail}`)
      } else if (selection.value._tag === "Ours") mine.push(card)
      else {
        rows.set(card.id, outcomeRow(card, "skipped", selection.value.detail))
        if (selection.value._tag === "Erred") erred.push(`${card.id}: ${selection.value.detail}`)
      }
    }
    // An error is not an empty backlog: a round that would launch nothing
    // because selection erred stops with the cause.
    if (mine.length === 0 && erred.length > 0) {
      return yield* new Stop({
        message: `round ${index} launched nothing: selection failed for ${erred.length} of ${fresh.length} items; ${
          erred.slice(0, 3).join("; ")
        }`
      })
    }
    // The first `budget` items launch unasked; every later admission asks
    // the round's capacity.
    const budget = Math.min(slots ?? mine.length, mine.length)
    const first = mine.slice(0, Math.min(concurrency, budget))
    let next = first.length
    let working = 0
    const claimed = new Set<Card<It>>()
    const executionId = (card: Card<It>) => `${key}/${card.id}`
    // Only a recorded cancel makes an interruption final; an unanswerable
    // question counts as no cancel.
    const wasCancelled = (card: Card<It>): Effect.Effect<boolean, Stop, R> =>
      cancelled === undefined
        ? Effect.succeed(false)
        : Effect.suspend(() => cancelled({ ...args(card), executionId: executionId(card) })).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) => {
              const error = cause.reasons.find(Cause.isFailReason)?.error
              if (Cause.hasDies(cause)) return Effect.die(cause.reasons.find(Cause.isDieReason)!.defect)
              return isStop(error) ? Effect.fail(error) : Effect.succeed(false)
            },
            onSuccess: (answer) => Effect.succeed(answer === true)
          })
        )
    const attempt = (card: Card<It>): Effect.Effect<Attempt<W>, Stop, R> =>
      Effect.gen(function*() {
        const held = yield* Effect.suspend(() => claim(args(card))).pipe(
          Effect.tap(() => Effect.sync(() => claimed.add(card))),
          Effect.uninterruptible,
          Effect.matchCauseEffect({
            onSuccess: () => Effect.succeed<Observed<void>>({ _tag: "Value", value: undefined }),
            onFailure: (cause) => {
              const error = cause.reasons.find(Cause.isFailReason)?.error
              return !Cause.hasDies(cause) && ownTag(error, "Burndown/Held")
                ? Effect.succeed<Settled>({ _tag: "Settled", status: "held", detail: detailOf(error) })
                : failure("claim", cause)
            }
          })
        )
        if (held._tag === "Settled") return held
        return yield* Effect.suspend(() => work({ ...args(card), executionId: executionId(card) })).pipe(
          Effect.matchCauseEffect({
            onSuccess: (output) => Effect.succeed<Attempt<W>>({ _tag: "Worked", output }),
            onFailure: (cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.map(observe("cancelled", () => wasCancelled(card)), (cancel): Attempt<W> =>
                  cancel._tag === "Settled"
                    ? cancel
                    : { _tag: "Settled", status: cancel.value ? "failed" : "requeued", detail: "work: interrupted" })
                : failure("work", cause)
          })
        )
      })
    // A claim leaves `claimed` when its release starts, so no path releases
    // it twice. A release that started always finishes.
    const releaseOne = (card: Card<It>, row: Pick<Row, "status" | "detail">) =>
      Effect.uninterruptible(Effect.suspend(() => {
        claimed.delete(card)
        return Effect.suspend(() => release({ ...args(card), status: row.status, detail: row.detail })).pipe(
          Effect.matchCauseEffect({
            onSuccess: () => Effect.succeed(undefined),
            onFailure: (cause) => {
              const error = cause.reasons.find(Cause.isFailReason)?.error
              if (!Cause.hasDies(cause) && !isStop(error)) {
                return Effect.succeed<Settled>({ _tag: "Settled", status: row.status, detail: `release: ${detailOf(error)}` })
              }
              return failure("release", cause)
            }
          })
        )
      }))
    // A freed slot takes another item only when the capacity answers
    // `Available` with more slots than the work still in flight.
    const allows = capacity === undefined
      ? Effect.succeed(false)
      : Effect.suspend(() => capacity({ input: value, round: index })).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) => {
            const error = cause.reasons.find(Cause.isFailReason)?.error
            return isStop(error) && !Cause.hasDies(cause) ? Effect.fail(error) : Effect.succeed(false)
          },
          onSuccess: (answer) => Effect.succeed(isCapacity(answer) && answer._tag === "Available" && answer.slots > working)
        })
      )
    const admit: Effect.Effect<Card<It> | undefined, Stop, R> = Effect.suspend(() => {
      if (next < budget) return Effect.succeed(mine[next++])
      if (next >= mine.length) return Effect.succeed(undefined)
      return Effect.map(allows, (allowed) => allowed && next < mine.length ? mine[next++] : undefined)
    })
    const landings = yield* Queue.unbounded<{ readonly card: Card<It>; readonly output: W }, Cause.Done>()
    const releases = yield* Queue.unbounded<Card<It>, Cause.Done>()
    const settleRow = (card: Card<It>, status: Status, text: string) => {
      rows.set(card.id, outcomeRow(card, status, text))
      if (claimed.has(card)) Queue.offerUnsafe(releases, card)
    }
    const rendered = (output: W, landing: L | undefined): string => detail === undefined ? "" : detail(output, landing)
    // One slot: works an item, hands it on, and takes the next one admitted.
    const slot = (start: Card<It>) =>
      Effect.gen(function*() {
        let card: Card<It> | undefined = start
        while (card !== undefined) {
          working += 1
          const outcome = yield* attempt(card)
          working -= 1
          if (outcome._tag === "Settled") settleRow(card, outcome.status, outcome.detail)
          else if (land === undefined) {
            const output = outcome.output
            const row = yield* observe("detail", () => Effect.sync(() => rendered(output, undefined)))
            settleRow(card, row._tag === "Settled" ? row.status : "landed", row._tag === "Settled" ? row.detail : row.value)
          } else Queue.offerUnsafe(landings, { card, output: outcome.output })
          card = yield* admit
        }
      })
    const drain = <A>(queue: Queue.Dequeue<A, Cause.Done>, handle: (entry: A) => Effect.Effect<void, Stop, R>) =>
      Queue.take(queue).pipe(Effect.flatMap(handle), Effect.forever, Effect.catchIf(Cause.isDone, () => Effect.void))
    const landed = (card: Card<It>, output: W): Effect.Effect<Row, Stop, R> =>
      Effect.flatMap(
        observe("land", () => land!({ ...args(card), output })),
        (landing) =>
          landing._tag === "Settled"
            ? Effect.succeed(outcomeRow(card, landing.status, landing.detail))
            : Effect.map(
              observe("detail", () => Effect.sync(() => rendered(output, landing.value))),
              (row) => row._tag === "Settled" ? outcomeRow(card, row.status, row.detail) : outcomeRow(card, "landed", row.value)
            )
      )
    // Landings start in the order work finished, `landers` at a time.
    const lander = drain(landings, ({ card, output }) =>
      Effect.map(landed(card, output), (row) => settleRow(card, row.status, row.detail)))
    const releaser = drain(releases, (card) =>
      Effect.map(releaseOne(card, rows.get(card.id)!), (failed) => {
        if (failed !== undefined) {
          const row = rows.get(card.id)!
          rows.set(
            card.id,
            outcomeRow(card, failed.status, row.detail.length === 0 ? failed.detail : `${row.detail}; ${failed.detail}`)
          )
        }
      }))
    const each = { concurrency: "unbounded", discard: true } as const
    yield* Effect.onExit(
      Effect.all([
        Effect.andThen(Effect.forEach(first, slot, each), Queue.end(landings)),
        Effect.andThen(Effect.forEach(Array.from({ length: landers }), () => lander, each), Queue.end(releases)),
        Effect.forEach(first, () => releaser, each)
      ], each),
      (exit) =>
        Exit.isSuccess(exit) ? Effect.void : Effect.forEach(
          [...claimed],
          (card) =>
            Effect.flatMap(
              Cause.hasInterruptsOnly(exit.cause)
                ? observe("cancelled", () => wasCancelled(card)).pipe(
                  Effect.map((answer) => answer._tag === "Settled" || answer.value),
                  Effect.catch(() => Effect.succeed(true))
                )
                : Effect.succeed(true),
              (died) =>
                releaseOne(card, died ? { status: "failed", detail: "round died" } : { status: "requeued", detail: "round interrupted" })
            ).pipe(Effect.catch((error) => Effect.logWarning("Burndown release stopped during round cleanup", error))),
          { concurrency, discard: true }
        )
    )
    const result: RoundResult = {
      rows: cards.flatMap((card) => {
        const row = rows.get(card.id)
        return row === undefined ? [] : [row]
      }),
      launched: next,
      deferred: mine.length - next
    }
    return result
  })
}

/**
 * The stages of {@link run}. `discover` answers the backlog each round.
 * `dispatch` holds the stages and bounds of every round, as {@link round}
 * takes them. `capacity`, when present, is asked before each discovery.
 * `maxRounds` bounds every round, waits included.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, It extends Item, W, E, R, L, E2, R2, E3, R3> {
  readonly discover: (args: { readonly input: I; readonly round: number }) => Effect.Effect<ReadonlyArray<It>, E2, R2>
  readonly dispatch: RoundOptions<I, It, W, E, R, L>
  readonly capacity?: ((args: { readonly input: I; readonly round: number }) => Effect.Effect<Capacity, E3, R3>) | undefined
  readonly maxRounds: number
}

// A row is final unless it is `skipped` or `requeued`.
const isSettled = (status: Status): boolean => status !== "skipped" && status !== "requeued"

// A settled row is final; a skipped or requeued row gives way to the item's
// latest row.
const merge = (carried: ReadonlyArray<Row>, fresh: ReadonlyArray<Row>): ReadonlyArray<Row> => {
  const rows = new Map<string, Row>(carried.map((row) => [row.id, row]))
  for (const row of fresh) {
    const previous = rows.get(row.id)
    if (previous === undefined || !isSettled(previous.status)) rows.set(row.id, row)
  }
  return [...rows.values()]
}

/**
 * Works the backlog down round after round. A round asks `capacity`, when
 * present: `Available` caps the round at its `slots`; `WaitUntil` waits on
 * Effect's clock until the instant `at`, and the next round asks again. Then
 * the round discovers the backlog and runs {@link round} with the ids already
 * settled. A round that launched, deferred or requeued an item opens the next
 * one; a round with none of those settles `drained`, and the round budget
 * settles `max_rounds`.
 *
 * Fails with `PatternError`: `invalid_decorator` when `maxRounds` is not a
 * positive safe integer below `Number.MAX_SAFE_INTEGER`, and `exhausted` when
 * the capacity answers `Exhausted`. Fails with a round's {@link Stop}, and
 * with the discovery's or the capacity's own failure. A capacity answer
 * outside {@link Capacity} is a defect.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, It extends Item, W, E, R, L, E2, R2, E3 = never, R3 = never>(
  input: I,
  options: Options<I, It, W, E, R, L, E2, R2, E3, R3>
): Effect.Effect<Result, E2 | E3 | PatternError | Stop, R | R2 | R3> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const { capacity, discover, maxRounds } = options
  const dispatch = { ...options.dispatch }
  if (!bound(maxRounds) || maxRounds === Number.MAX_SAFE_INTEGER) {
    return Effect.fail(
      new PatternError({
        code: "invalid_decorator",
        message: "Burndown maxRounds must be a positive safe integer below Number.MAX_SAFE_INTEGER"
      })
    )
  }
  return Effect.gen(function*() {
    let rows: ReadonlyArray<Row> = []
    for (let index = 0; index < maxRounds; index++) {
      let slots: number | undefined
      if (capacity !== undefined) {
        const answer: unknown = yield* capacity({ input, round: index })
        if (!isCapacity(answer)) return yield* Effect.die(new Error(`Burndown capacity answered outside its contract`))
        if (answer._tag === "Exhausted") {
          return yield* Effect.fail(
            new PatternError({ code: "exhausted", message: `Burndown capacity is exhausted: ${answer.detail}` })
          )
        }
        if (answer._tag === "WaitUntil") {
          const now = yield* Clock.currentTimeMillis
          if (answer.at > now) yield* Effect.sleep(answer.at - now)
          continue
        }
        slots = answer.slots
      }
      const items = yield* discover({ input, round: index })
      const settled = rows.filter((row) => isSettled(row.status)).map((row) => row.id)
      const result = yield* round({ input, round: index, items, settled, ...(slots === undefined ? {} : { slots }) }, dispatch)
      rows = merge(rows, result.rows)
      const pending = result.launched > 0 || result.deferred > 0 || result.rows.some((row) => row.status === "requeued")
      if (!pending) {
        const drained: Result = { rows, rounds: index + 1, stopped: "drained" }
        return drained
      }
    }
    const spent: Result = { rows, rounds: maxRounds, stopped: "max_rounds" }
    return spent
  })
}

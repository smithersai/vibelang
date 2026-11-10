/**
 * Durable execution: a journaled engine for Effect's own workflows.
 *
 * Effect 4.1.1 defines workflows (`Workflow.make`), recorded steps
 * (`Activity.make`) and the `WorkflowEngine` service they run on, and ships
 * one engine, `WorkflowEngine.layerMemory`, which forgets every run when the
 * process exits. This module adds the engine that remembers. Each step's
 * start and result go to an append-only journal, one per run. A run that
 * stops part way, because its process crashed or was killed, resumes the
 * next time anything executes it: the body runs again, and every step the
 * journal finished returns its recorded result instead of running.
 *
 * A program picks a store with one layer. {@link memory} keeps runs in this
 * process; {@link layerStore} runs over any {@link Store}. There is no
 * default engine: a workflow with no engine has a missing requirement.
 *
 * Guarantees:
 *
 * - A finished step never runs twice in one run. A step journals
 *   `StepStarted` before its body and `StepCompleted` with its result after,
 *   and a restart reads the record.
 * - A step that did not finish can run again. A crash after an outside
 *   effect and before `StepCompleted` repeats the step, so delivery is
 *   at-least-once: an irreversible step carries an idempotency key that its
 *   destination deduplicates.
 * - One owner per run. Every engine that loads a run claims it and raises its
 *   fence, and every write of the run's state is fenced: an engine that lost
 *   the run to another dies with {@link FenceLost} on its next write.
 * - A step's event and its state commit together, so the journal has no holes.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Random from "effect/Random"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { SqlClient } from "effect/sql"
import { Activity, Workflow, WorkflowEngine } from "effect/workflow"
import * as canonical from "./internal/canonical.js"
import * as engineInternal from "./internal/durableEngine.js"
import * as sqlStore from "./internal/durableSql.js"
import * as store from "./internal/durableStore.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Durable"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Durable"

/**
 * The storage an engine journals into: run rows, one append-only journal per
 * run, and a result cache. Every value it holds is JSON the engine already
 * encoded with the step's or the workflow's schema. Implement it to put runs
 * in another database.
 *
 * @category models
 * @since 0.0.13
 */
export type Store = store.Store

/**
 * A stored run.
 *
 * @category models
 * @since 0.0.13
 */
export type RunRow = store.RunRow

/**
 * Where a run stands: `running`, `suspended`, or terminal (`succeeded`,
 * `failed`, `interrupted`).
 *
 * @category models
 * @since 0.0.13
 */
export type RunStatus = store.RunStatus

/**
 * One journal event. `seq` counts from 1 in each run, with no holes.
 *
 * Event types: `RunStarted`, `StepStarted` (`step`, `attempt`, and the task's
 * `tier`), `StepCompleted` (`step`, `attempt`, `exit`), `DeferredDone`
 * (`name`, `exit`), `ClockScheduled` (`name`, `wakeAt`), `RunSuspended`,
 * `RunCompleted` (`status`, `result`), `RunForked` (`from`) and `RunRewound`
 * (`to`).
 * A step's `exit` is Effect's JSON encoding of an `Exit` of the step's
 * encoded result.
 *
 * @category models
 * @since 0.0.13
 */
export type JournalEntry = store.JournalEntry

/**
 * A write refused because another engine claimed the run after this one.
 *
 * @category errors
 * @since 0.0.13
 */
export const FenceLost = store.FenceLost

/**
 * @category errors
 * @since 0.0.13
 */
export type FenceLost = store.FenceLost

/**
 * A store in this process's memory, gone at exit. A real store, not a mock:
 * engines that share one see each other's runs, which is how a test crashes
 * one engine and resumes its run on another.
 *
 * @category constructors
 * @since 0.0.13
 */
export const makeMemoryStore: () => Store = store.makeMemory

/**
 * The running engine, for the calls that read or change stored runs.
 *
 * @category services
 * @since 0.0.13
 */
export interface Durable {
  readonly [TypeId]: TypeId
  /** @internal */
  readonly internals: engineInternal.EngineInternals
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.13
 */
export const Durable: Context.Service<Durable, Durable> = /* @__PURE__ */ Context.Service<Durable>(
  "vibelang/experimental/Durable"
)

/**
 * A journaled `WorkflowEngine` over `store`, with the {@link Durable}
 * service. Engines built from one store share its runs.
 *
 * @category layers
 * @since 0.0.13
 */
export const layerStore = (store: Store): Layer.Layer<WorkflowEngine.WorkflowEngine | Durable> =>
  Layer.effectContext(
    Effect.map(engineInternal.make(store), ({ engine, internals }) =>
      Context.make(WorkflowEngine.WorkflowEngine, engine).pipe(
        Context.add(Durable, { [TypeId]: TypeId, internals })
      ))
  )

/**
 * A journaled engine whose runs live in a SQL database, through Effect's
 * `SqlClient`: provide one of Effect's clients, such as `SqliteClient.layer({
 * filename })` from `@effect/sql-sqlite-node` or `@effect/sql-sqlite-bun`, or
 * `PgClient.layer` from `@effect/sql-pg`. The tables `durable_runs`,
 * `durable_journal` and `durable_cache` are created if missing. Runs survive
 * the process: a program killed mid-run resumes it on its next start. A SQL
 * failure is a defect.
 *
 * @category layers
 * @since 0.0.13
 */
export const layerSql: Layer.Layer<WorkflowEngine.WorkflowEngine | Durable, never, SqlClient.SqlClient> = /* @__PURE__ */ Layer
  .unwrap(/* @__PURE__ */ Effect.map(/* @__PURE__ */ Effect.orDie(sqlStore.make), layerStore))

/**
 * A journaled engine over a fresh {@link makeMemoryStore}. Runs survive an
 * interrupted fiber but not the process.
 *
 * @category layers
 * @since 0.0.13
 */
export const memory: Layer.Layer<WorkflowEngine.WorkflowEngine | Durable> = /* @__PURE__ */ Layer.unwrap(
  /* @__PURE__ */ Effect.sync(() => layerStore(store.makeMemory()))
)

/**
 * VIP-44 identity: a function that writes a value of `schema` as text that is
 * equal exactly when the values are equal. Sets and maps are sorted first, the
 * value is encoded with the schema's JSON codec, and the result is RFC 8785
 * canonical JSON, so the order sets, maps and object keys were built in does
 * not matter. Array order does. Use it as a workflow's `idempotencyKey`, as
 * {@link workflow} does by default.
 *
 * @category identity
 * @since 0.0.13
 */
export const identity = <S extends Schema.Top>(schema: S): (value: S["Type"]) => string => (value) =>
  canonical.identity(schema, value)

/**
 * Effect's `Workflow.make`, with run identity from VIP-44: unless
 * `idempotencyKey` is given, equal payloads, compared by {@link identity},
 * name one run. Executing the workflow again with an equal payload joins
 * that run, so a program that crashed and starts again resumes it with no
 * saved id. The body receives the payload as it was hashed: its sets and
 * maps iterate in sorted order.
 *
 * @category constructors
 * @since 0.0.13
 */
export const workflow = <
  const Tag extends string,
  Payload extends Schema.Struct.Fields,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = Schema.Never
>(tag: Tag, options: {
  readonly payload: Payload
  readonly success?: Success | undefined
  readonly error?: Error | undefined
  readonly idempotencyKey?: ((payload: Schema.Struct.Type<Payload>) => string) | undefined
  readonly suspendedRetrySchedule?: Parameters<typeof Workflow.make>[1]["suspendedRetrySchedule"]
  readonly annotations?: Context.Context<never> | undefined
}): Workflow.Workflow<Tag, Schema.Struct<Payload>, Success, Error> => {
  const payload = Schema.Struct(options.payload)
  return Workflow.make(tag, {
    payload: options.payload,
    success: options.success as Success,
    error: options.error as Error,
    idempotencyKey: options.idempotencyKey ?? identity(payload),
    suspendedRetrySchedule: options.suspendedRetrySchedule,
    annotations: options.annotations
  }) as unknown as Workflow.Workflow<Tag, Schema.Struct<Payload>, Success, Error>
}

/**
 * A run's journal, in order.
 *
 * @category time travel
 * @since 0.0.13
 */
export const history = (run: string): Stream.Stream<JournalEntry, never, Durable> =>
  Stream.unwrap(Effect.map(Effect.service(Durable), (durable) => Stream.fromIterableEffect(durable.internals.store.entries(run))))

/**
 * Smithers' retry policy, as data. The delay before attempt `n + 1` is
 * `initialMs * factor ** (n - 1)`, at most `maxMs`. With neither
 * `maxAttempts` nor `expirationMs` the policy never gives up.
 *
 * @category models
 * @since 0.0.13
 */
export interface RetryPolicy {
  readonly initialMs: number
  readonly factor: number
  readonly maxMs: number
  /** Attempts in all, the first included. */
  readonly maxAttempts?: number | undefined
  /** Stop retrying once this long has passed since the first retry. */
  readonly expirationMs?: number | undefined
  /** Randomize each delay. Any value above 0 turns on Effect's `Schedule.jittered`. */
  readonly jitterRatio?: number | undefined
}

/**
 * How far a task's effects reach: `sealed` touches nothing outside its
 * result, `compensable` can be undone, and `irreversible` cannot.
 *
 * @category models
 * @since 0.0.13
 */
export type Tier = "sealed" | "compensable" | "irreversible"

/**
 * The options of {@link task}, under Smithers' names.
 *
 * @category models
 * @since 0.0.13
 */
export interface TaskOptions<Payload extends Schema.Struct.Fields, Success extends Schema.Top, Error extends Schema.Top> {
  readonly payload: Payload
  readonly success?: Success | undefined
  readonly error?: Error | undefined
  readonly tier?: Tier | undefined
  readonly retryPolicy?: RetryPolicy | undefined
  /** Bound each attempt. A timed-out attempt is a defect, which the journal records. */
  readonly attemptTimeoutMs?: number | undefined
  /**
   * What makes two calls equal for the cache: a value, or a function of the
   * payload. By default the payload's VIP-44 identity.
   */
  readonly idempotencyKey?: unknown
  /** Names the code that computes the result. A cached result is reused only under the same version. */
  readonly implementationVersion?: string | undefined
  /** Reuse a successful result for an equal call. See {@link CacheOptions}. */
  readonly cache?: CacheOptions | undefined
}

/**
 * Smithers' `Action.withCache`. A successful result is stored under a key
 * made of the scope, the task's key, its `implementationVersion` and the
 * call's idempotency key, and an equal call within the scope returns it
 * without running the handler.
 *
 * - `scope: "run"` (the default) reuses within one run.
 * - `scope: "flow"` reuses across runs of the same workflow.
 * - `scope: "shared"` reuses across every workflow on the store.
 *
 * Reuse across runs is opt-in: `"flow"` and `"shared"` need an
 * `implementationVersion`, so a result is never served to different code.
 * Only a `"sealed"` task caches, because a cached call skips the handler and
 * so its outside effects. A cache entry may expire after `ttlMs` or be
 * swept. A run's committed result never depends on one: once a step
 * finishes, the journal serves it.
 *
 * @category models
 * @since 0.0.13
 */
export interface CacheOptions {
  readonly ttlMs?: number | undefined
  readonly scope?: "run" | "flow" | "shared" | undefined
}

/**
 * The implementation a task's layer provides.
 *
 * @category models
 * @since 0.0.13
 */
export interface TaskHandler<Payload, A, E> {
  readonly run: (payload: Payload) => Effect.Effect<A, E>
}

/**
 * A recorded step with a payload. Calling it inside a workflow runs one step:
 * an Effect `Activity` named `<key>/<n>`, where `n` counts this task's calls
 * in the run, so two calls of one task are two steps. Its implementation is a
 * service, so a test or another host swaps it by providing another layer.
 *
 * @category models
 * @since 0.0.13
 */
export interface Task<Key extends string, Payload extends Schema.Struct.Fields, Success extends Schema.Top, Error extends Schema.Top> {
  (payload: Schema.Struct.Type<Payload>): Effect.Effect<
    Success["Type"],
    Error["Type"],
    | TaskHandler<Schema.Struct.Type<Payload>, Success["Type"], Error["Type"]>
    | WorkflowEngine.WorkflowEngine
    | WorkflowEngine.WorkflowInstance
  >
  readonly key: Key
  readonly options: TaskOptions<Payload, Success, Error>
  /** The same as calling the task. */
  readonly call: (payload: Schema.Struct.Type<Payload>) => ReturnType<Task<Key, Payload, Success, Error>>
  readonly Handler: Context.Service<
    TaskHandler<Schema.Struct.Type<Payload>, Success["Type"], Error["Type"]>,
    TaskHandler<Schema.Struct.Type<Payload>, Success["Type"], Error["Type"]>
  >
  /** The task's implementation as a layer. The handler's requirements become the layer's. */
  readonly toLayer: <R>(
    handler: (payload: Schema.Struct.Type<Payload>) => Effect.Effect<Success["Type"], Error["Type"], R>
  ) => Layer.Layer<TaskHandler<Schema.Struct.Type<Payload>, Success["Type"], Error["Type"]>, never, Exclude<R, never>>
}

/** The delay before `attempt` (2 or more), from the policy alone. */
const retryDelay = (policy: RetryPolicy, attempt: number): number =>
  Math.min(policy.maxMs, policy.initialMs * policy.factor ** (attempt - 2))

/**
 * Whether the policy allows `attempt`. It depends only on the attempt
 * number, which the journal keeps, so a restart neither loses nor repeats a
 * retry. `expirationMs` bounds the sum of the delays before `attempt`.
 */
const retryAllows = (policy: RetryPolicy, attempt: number): boolean => {
  if (policy.maxAttempts !== undefined && attempt > policy.maxAttempts) return false
  if (policy.expirationMs !== undefined) {
    let waited = 0
    for (let n = 2; n <= attempt; n++) waited += retryDelay(policy, n)
    if (waited > policy.expirationMs) return false
  }
  return true
}

/** Waits the policy's delay before every attempt after the first. */
const backoff = (policy: RetryPolicy): Effect.Effect<void> =>
  Effect.gen(function*() {
    const attempt = yield* Activity.CurrentAttempt
    if (attempt < 2) return
    const delay = retryDelay(policy, attempt)
    const ratio = policy.jitterRatio ?? 0
    const random = ratio > 0 ? yield* Random.next : 0.5
    yield* Effect.sleep(Math.max(0, delay * (1 + (random * 2 - 1) * ratio)))
  })

const occurrences = new WeakMap<object, Map<string, number>>()
const nextOccurrence = (instance: object, key: string): number => {
  let counts = occurrences.get(instance)
  if (counts === undefined) {
    counts = new Map()
    occurrences.set(instance, counts)
  }
  const n = (counts.get(key) ?? 0) + 1
  counts.set(key, n)
  return n
}

/**
 * Declares a task: a recorded step with a payload, a result and a typed
 * failure. `key` names it in the journal, so it must not change while runs
 * that used it are stored.
 *
 * @category constructors
 * @since 0.0.13
 */
export const task = <
  const Key extends string,
  Payload extends Schema.Struct.Fields,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = Schema.Never
>(key: Key, options: TaskOptions<Payload, Success, Error>): Task<Key, Payload, Success, Error> => {
  type P = Schema.Struct.Type<Payload>
  type Handler = TaskHandler<P, Success["Type"], Error["Type"]>
  const Handler = Context.Service<Handler>(`vibelang/experimental/Durable/Task/${key}`)
  const success = (options.success ?? Schema.Void) as Schema.Top
  const error = (options.error ?? Schema.Never) as Schema.Top
  const tier = options.tier ?? "sealed"
  const info = { tier }
  const cache = options.cache
  if (cache !== undefined) {
    if (tier !== "sealed") throw new globalThis.Error(`Task ${key}: only a sealed task caches; this one is ${tier}`)
    if ((cache.scope === "flow" || cache.scope === "shared") && options.implementationVersion === undefined) {
      throw new globalThis.Error(`Task ${key}: a ${cache.scope} cache reuses results across runs and needs an implementationVersion`)
    }
  }
  const payloadSchema = Schema.Struct(options.payload)
  const successJson = Schema.toCodecJson(success) as unknown as Schema.Codec<unknown, unknown>
  const cacheKey = (payload: P, instance: WorkflowEngine.WorkflowInstance["Service"]) => {
    const scope = cache?.scope ?? "run"
    const within = scope === "run" ? instance.executionId : scope === "flow" ? instance.workflow._tag : ""
    const equal = options.idempotencyKey === undefined
      ? canonical.snapshot(payloadSchema, payload)
      : typeof options.idempotencyKey === "function"
      ? (options.idempotencyKey as (payload: P) => unknown)(payload)
      : options.idempotencyKey
    return canonical.sha256(canonical.canonicalJson([scope, within, key, options.implementationVersion ?? null, equal]))
  }
  const cached = (body: Effect.Effect<unknown, unknown>, cacheKey: string): Effect.Effect<unknown, unknown> =>
    Effect.gen(function*() {
      const durable = yield* Effect.serviceOption(Durable)
      if (Option.isNone(durable)) return yield* body
      const store = durable.value.internals.store
      const hit = yield* store.cacheGet(cacheKey, yield* Clock.currentTimeMillis)
      if (Option.isSome(hit)) return Schema.decodeUnknownSync(successJson)(hit.value)
      const value = yield* body
      const now = yield* Clock.currentTimeMillis
      yield* store.cachePut(cacheKey, {
        value: Schema.encodeSync(successJson)(value),
        expiresAt: cache?.ttlMs === undefined ? undefined : now + cache.ttlMs
      })
      return value
    })
  const call = (payload: P) =>
    Effect.gen(function*() {
      const instance = yield* WorkflowEngine.WorkflowInstance
      const handler = yield* Handler
      const n = nextOccurrence(instance, key)
      let body: Effect.Effect<unknown, unknown> = handler.run(payload)
      if (options.attemptTimeoutMs !== undefined) {
        const ms = options.attemptTimeoutMs
        body = Effect.timeoutOrElse(body, {
          duration: ms,
          orElse: () => Effect.die(new globalThis.Error(`Task ${key} attempt timed out after ${ms} ms`))
        })
      }
      if (cache !== undefined) body = cached(body, yield* cacheKey(payload, instance))
      const policy = options.retryPolicy
      if (policy !== undefined) body = Effect.andThen(backoff(policy), body)
      const activity = Activity.make({ name: `${key}/${n}`, success, error, execute: body })
      let attempts = 1
      const step = policy === undefined
        ? activity
        : Activity.retry(activity, { while: () => retryAllows(policy, ++attempts) })
      return yield* Effect.provideService(step, engineInternal.StepInfo, info)
    }) as ReturnType<Task<Key, Payload, Success, Error>>
  const self = Object.assign((payload: P) => call(payload), {
    key,
    options,
    call,
    Handler,
    toLayer: <R>(handler: (payload: P) => Effect.Effect<Success["Type"], Error["Type"], R>) =>
      Layer.effect(
        Handler,
        Effect.map(Effect.context<R>(), (context) => ({
          run: (payload: P) => Effect.provideContext(handler(payload), context)
        }))
      )
  })
  return self as unknown as Task<Key, Payload, Success, Error>
}

/**
 * A position in history: a run and a sequence number in its journal.
 *
 * @category time travel
 * @since 0.0.13
 */
export interface Position {
  readonly run: string
  readonly seq: number
}

/**
 * Why {@link fork} or {@link rewind} refused, from Smithers' closed list.
 * This engine raises `not_found`, `invalid`, `busy`, `irreversible` and
 * `compensation_failed`; the others are reserved for engines that need them.
 *
 * @category errors
 * @since 0.0.13
 */
export type TimeTravelErrorCode =
  | "busy"
  | "live_parent"
  | "live_child"
  | "not_found"
  | "invalid"
  | "already_crossed"
  | "rate_limited"
  | "compensation_failed"
  | "irreversible"
  | "fence_lost"
  | "limit_exceeded"
  | "unknown"

/**
 * @category errors
 * @since 0.0.13
 */
export class TimeTravelError extends Data.TaggedError("TimeTravelError")<{
  readonly code: TimeTravelErrorCode
  readonly message: string
}> {}

const refuse = (code: TimeTravelErrorCode, message: string) => Effect.fail(new TimeTravelError({ code, message }))

const journalOf = (durable: Durable, run: string) =>
  Effect.gen(function*() {
    const row = yield* durable.internals.store.get(run)
    if (Option.isNone(row)) return yield* refuse("not_found", `No run ${run}`)
    const entries = yield* durable.internals.store.entries(run)
    return { row: row.value, entries }
  })

/**
 * Folds the run's journal from its first entry through `at.seq`. It reads
 * only the journal: it runs nothing, needs no workflow registered, and
 * changes nothing.
 *
 * @category time travel
 * @since 0.0.13
 */
export const replay = <S>(at: Position, fold: {
  readonly initial: S
  readonly reduce: (state: S, entry: JournalEntry) => S
}): Effect.Effect<S, TimeTravelError, Durable> =>
  Effect.gen(function*() {
    const durable = yield* Durable
    const { entries } = yield* journalOf(durable, at.run)
    if (!Number.isInteger(at.seq) || at.seq < 1 || at.seq > entries.length) {
      return yield* refuse("invalid", `Run ${at.run} has entries 1 to ${entries.length}, not ${at.seq}`)
    }
    let state = fold.initial
    for (const entry of entries) {
      if (entry.seq > at.seq) break
      state = fold.reduce(state, entry)
    }
    return state
  })

/**
 * A new run that starts as `at.run` was just before `at.seq`: it reuses
 * every step the journal finished before that position and runs the rest
 * when it is resumed or executed, with {@link run}. The original run is
 * unchanged. A fork's first event after the copied ones is `RunForked`.
 *
 * @category time travel
 * @since 0.0.13
 */
export const fork = (at: Position): Effect.Effect<{ readonly run: string }, TimeTravelError, Durable> =>
  Effect.gen(function*() {
    const durable = yield* Durable
    const { entries } = yield* journalOf(durable, at.run)
    if (!Number.isInteger(at.seq) || at.seq < 2 || at.seq > entries.length + 1) {
      return yield* refuse("invalid", `A fork of run ${at.run} starts at 2 to ${entries.length + 1}, not ${at.seq}`)
    }
    const store = durable.internals.store
    const target = (yield* canonical.sha256(`fork:${at.run}:${at.seq}:${globalThis.crypto.randomUUID()}`)).slice(0, 32)
    const now = yield* Clock.currentTimeMillis
    yield* Effect.orDie(store.fork(at.run, at.seq, target, now))
    yield* Effect.orDie(store.append(target, [{ eventType: "RunForked", payload: { from: { run: at.run, seq: at.seq } } }], now))
    return { run: target }
  })

/**
 * Truncates the run to the entries before `at.seq` and leaves it suspended:
 * the next execution replays the kept steps and runs the rest again. The
 * engine claims the run, so another engine still driving it dies with
 * `FenceLost` at its next write. Refuses with `busy` while this engine is
 * running it, and with `irreversible` when a removed step was an
 * irreversible task's, because no engine can unsend an email. Undoing a
 * compensable step is not built, so crossing one is `compensation_failed`.
 *
 * @category time travel
 * @since 0.0.13
 */
export const rewind = (at: Position): Effect.Effect<void, TimeTravelError, Durable> =>
  Effect.gen(function*() {
    const durable = yield* Durable
    const { entries } = yield* journalOf(durable, at.run)
    if (!Number.isInteger(at.seq) || at.seq < 2 || at.seq > entries.length + 1) {
      return yield* refuse("invalid", `A rewind of run ${at.run} keeps entries before 2 to ${entries.length + 1}, not ${at.seq}`)
    }
    if (durable.internals.isLive(at.run)) return yield* refuse("busy", `Run ${at.run} is running`)
    for (const entry of entries) {
      if (entry.seq < at.seq || entry.eventType !== "StepStarted") continue
      const { step, tier } = entry.payload as { readonly step: string; readonly tier?: Tier }
      if (tier === "irreversible") return yield* refuse("irreversible", `Step ${step} at ${entry.seq} is irreversible`)
      if (tier === "compensable") {
        return yield* refuse("compensation_failed", `Step ${step} at ${entry.seq} is compensable, and compensation is not built`)
      }
    }
    const store = durable.internals.store
    const now = yield* Clock.currentTimeMillis
    durable.internals.evict(at.run)
    const fence = yield* Effect.orDie(store.truncate(at.run, at.seq, durable.internals.owner, now))
    yield* Effect.orDie(store.commit(at.run, { fence, events: [{ eventType: "RunRewound", payload: { to: at.seq } }] }, now))
  })

/**
 * Stored runs, optionally only those with a status or of one workflow.
 *
 * @category runs
 * @since 0.0.13
 */
export const runs = (filter: { readonly status?: RunStatus; readonly workflow?: string } = {}): Stream.Stream<RunRow, never, Durable> =>
  Stream.unwrap(Effect.map(Effect.service(Durable), (durable) => Stream.fromIterableEffect(durable.internals.store.list(filter))))

/**
 * Deletes finished runs last changed more than `olderThan` ago, and expired
 * cache entries. Returns how many runs it deleted. Nothing is deleted on a
 * schedule the program did not set.
 *
 * @category runs
 * @since 0.0.13
 */
export const sweep = (options: { readonly olderThan: Duration.Input }): Effect.Effect<number, never, Durable> =>
  Effect.gen(function*() {
    const durable = yield* Durable
    const now = yield* Clock.currentTimeMillis
    return yield* durable.internals.store.sweep(now - Duration.toMillis(Duration.fromInputUnsafe(options.olderThan)), now)
  })

/**
 * A handle on a stored run of `W`. It is a value over the id: build one again
 * from the id at any time.
 *
 * @category runs
 * @since 0.0.13
 */
export interface Run<A, E> {
  readonly id: string
  /** Waits for the run, resuming it if it is stopped. A finished run gives its recorded result. */
  readonly result: Effect.Effect<A, E, WorkflowEngine.WorkflowEngine | Durable>
  /** The exit once the run has finished; none while it runs or waits. */
  readonly poll: Effect.Effect<Option.Option<Exit.Exit<A, E>>, never, WorkflowEngine.WorkflowEngine>
  /** Interrupts the run. */
  readonly cancel: Effect.Effect<void, never, WorkflowEngine.WorkflowEngine>
  /** Drives a stopped run again, without waiting. */
  readonly resume: Effect.Effect<void, never, WorkflowEngine.WorkflowEngine>
}

type AnyWorkflow = Workflow.Workflow<string, Workflow.AnyStructSchema, Schema.Top, Schema.Top>

/**
 * The handle of run `id` of `W`.
 *
 * @category runs
 * @since 0.0.13
 */
export const run = <W extends AnyWorkflow>(W: W, id: string): Run<W["successSchema"]["Type"], W["errorSchema"]["Type"]> => ({
  id,
  result: Effect.gen(function*() {
    const durable = yield* Durable
    const row = yield* durable.internals.store.get(id)
    if (Option.isNone(row)) return yield* Effect.die(new TimeTravelError({ code: "not_found", message: `No run ${id}` }))
    const engine = yield* WorkflowEngine.WorkflowEngine
    const payload = engineInternal.decodePayload(W, row.value.payload)
    return yield* engine.execute(W, { executionId: id, payload })
  }) as Run<W["successSchema"]["Type"], W["errorSchema"]["Type"]>["result"],
  poll: Effect.map(W.poll(id), (result) =>
    Option.flatMap(result, (result) => result._tag === "Complete" ? Option.some(result.exit) : Option.none())) as Run<
      W["successSchema"]["Type"],
      W["errorSchema"]["Type"]
    >["poll"],
  cancel: W.interrupt(id),
  resume: W.resume(id)
})

/**
 * Starts the run `W` would run for `payload`, or joins it if it exists, and
 * returns its handle at once.
 *
 * @category runs
 * @since 0.0.13
 */
export const spawn = <W extends AnyWorkflow>(W: W, payload: Schema.Struct.Type<W["payloadSchema"]["fields"]>) =>
  Effect.gen(function*() {
    const id = yield* W.executionId(payload)
    yield* W.execute(payload, { discard: true })
    return run(W, id)
  })

/**
 * Always starts a new run of `W`, even when an equal payload already has one,
 * and returns its handle. Use it for work that must happen again, such as a
 * scheduled occurrence.
 *
 * @category runs
 * @since 0.0.13
 */
export const start = <W extends AnyWorkflow>(W: W, payload: Schema.Struct.Type<W["payloadSchema"]["fields"]>) =>
  Effect.gen(function*() {
    const engine = yield* WorkflowEngine.WorkflowEngine
    const id = (yield* canonical.sha256(`start:${W._tag}:${globalThis.crypto.randomUUID()}`)).slice(0, 32)
    yield* engine.execute(W, { executionId: id, payload: W.payloadSchema.make(payload), discard: true })
    return run(W, id)
  })

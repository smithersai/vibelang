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
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Random from "effect/Random"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { Activity, WorkflowEngine } from "effect/workflow"
import * as engineInternal from "./internal/durableEngine.js"
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
 * (`name`, `exit`), `RunSuspended` and `RunCompleted` (`status`, `result`).
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
  const info = { tier: options.tier ?? "sealed" }
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

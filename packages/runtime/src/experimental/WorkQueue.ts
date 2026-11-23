/**
 * Durable work queues: a workflow hands a payload to a pool of workers and
 * parks until one answers.
 *
 * {@link process} offers the payload to a persisted queue under an id the
 * run derives, and waits on a `DurableDeferred` of Effect's workflow
 * module. A {@link worker} takes the item, runs the handler, and records
 * the handler's exit through that deferred, which wakes the run with the
 * typed success or failure. It ports `DurableQueue` from `@smthrs/flow`,
 * built on Effect's `PersistedQueue` and `DurableDeferred`; Effect's own
 * `Queue` and `DurableQueue` keep their names and meanings.
 *
 * Guarantees:
 *
 * - A replay of the same offer derives the same item: the id is the run,
 *   the queue, the payload's `key`, and how many offers with that key the run
 *   made before it.
 * - The queue never drops an item: a delivery that could not start, or a
 *   handler interrupted before it finished, is delivered again.
 * - Until the handler's exit is recorded, a crash runs the handler again. A
 *   handler makes its side effects idempotent.
 * - A parked run waits on an event: `Experimental.Durable.waiting` shows the
 *   reason `event` under the queue's name until the worker answers.
 * - It is a request and its answer, not a broker: no order across hosts and
 *   no batch acknowledgement.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as PersistedQueue from "effect/persistence/PersistedQueue"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { Activity, DurableDeferred, WorkflowEngine } from "effect/workflow"
import * as waits from "./internal/durableWaits.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/WorkQueue"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/WorkQueue"

/**
 * A declared queue: its name, payload, the worker's success and failure,
 * and the key that names an offer.
 *
 * @category models
 * @since 0.0.13
 */
export interface WorkQueue<Payload extends Schema.Top, Success extends Schema.Top = Schema.Void, Error extends Schema.Top = Schema.Never> {
  readonly [TypeId]: TypeId
  readonly name: string
  readonly payloadSchema: Payload
  readonly successSchema: Success
  readonly errorSchema: Error
  readonly key: (payload: Payload["Type"]) => string
}

/**
 * Declares a queue. `key` is required: offers with equal keys in one run are
 * counted, so the n-th offer with a key is the same item on every replay.
 * `payload` is a schema or the fields of a struct.
 *
 * @category constructors
 * @since 0.0.13
 */
export const make = <
  Payload extends Schema.Top | Schema.Struct.Fields,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = Schema.Never
>(name: string, options: {
  readonly payload: Payload
  readonly success?: Success | undefined
  readonly error?: Error | undefined
  readonly key: (payload: Payload extends Schema.Struct.Fields ? Schema.Struct.Type<Payload> : Payload["Type"]) => string
}): WorkQueue<Payload extends Schema.Struct.Fields ? Schema.Struct<Payload> : Payload, Success, Error> =>
  ({
    [TypeId]: TypeId,
    name,
    payloadSchema: Schema.isSchema(options.payload) ? options.payload : Schema.Struct(options.payload as Schema.Struct.Fields),
    successSchema: options.success ?? Schema.Void,
    errorSchema: options.error ?? Schema.Never,
    key: options.key
  }) as any

const queueName = (queue: WorkQueue<Schema.Top, Schema.Top, Schema.Top>) => `WorkQueue/${queue.name}`

const itemSchemas = new WeakMap<Schema.Top, Schema.Top>()
const itemSchema = (payload: Schema.Top) => {
  let schema = itemSchemas.get(payload)
  if (schema === undefined) {
    schema = Schema.Struct({ token: DurableDeferred.Token, payload })
    itemSchemas.set(payload, schema)
  }
  return schema as Schema.Struct<{ token: typeof DurableDeferred.Token; payload: Schema.Top }>
}

const deferredOf = <Success extends Schema.Top, Error extends Schema.Top>(queue: WorkQueue<Schema.Top, Success, Error>, id: string) =>
  DurableDeferred.make(`${queueName(queue)}/${id}`, { success: queue.successSchema, error: queue.errorSchema })

// Offers per key in one execution of a run's body. A resumed run gets a new
// instance, so its replay counts from the start again.
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

const offerRetry = Schedule.min([Schedule.exponential(500, 1.5), Schedule.spaced("1 minute")])

/**
 * Offers `payload` and parks the run until a worker records its result,
 * then returns the worker's success or fails with its typed failure. A
 * payload the schema refuses is a defect. A store that refuses the offer is
 * retried, from half a second up to a minute apart, without a limit.
 *
 * @category processing
 * @since 0.0.13
 */
export const process = <Payload extends Schema.Top, Success extends Schema.Top, Error extends Schema.Top>(
  queue: WorkQueue<Payload, Success, Error>,
  payload: Payload["~type.make.in"]
): Effect.Effect<
  Success["Type"],
  Error["Type"],
  | WorkflowEngine.WorkflowEngine
  | WorkflowEngine.WorkflowInstance
  | PersistedQueue.PersistedQueueFactory
  | Payload["EncodingServices"]
  | Payload["DecodingServices"]
  | Success["DecodingServices"]
  | Error["DecodingServices"]
> =>
  Effect.gen(function*() {
    const any = queue as unknown as WorkQueue<Schema.Top, Success, Error>
    const value = yield* Effect.orDie(Effect.mapError(queue.payloadSchema.makeEffect(payload), (issue) => new Schema.SchemaError(issue)))
    const instance = yield* WorkflowEngine.WorkflowInstance
    const key = queue.key(value)
    const n = nextOccurrence(instance, `${queue.name}\u0000${key}`)
    const id = yield* Activity.idempotencyKey(`${queueName(any)}/${key}/${n}`)
    const deferred = deferredOf(any, id)
    const token = yield* DurableDeferred.token(deferred)
    // The run waits on an event, as a signal's wait does: `Durable.waiting`
    // shows it under the queue's name until the worker's exit is recorded.
    yield* waits.announce(
      `${deferred.name}/wait`,
      { reason: "event", name: queue.name, deferred: deferred.name, closedBy: [deferred.name] },
      Schema.Void,
      Effect.void
    )
    const persisted = yield* PersistedQueue.make({ name: queueName(any), schema: itemSchema(queue.payloadSchema) })
    yield* persisted.offer({ token, payload: value }, { id }).pipe(
      Effect.catchTag("SchemaError", Effect.die),
      Effect.tapCause((cause) => Effect.logWarning("WorkQueue offer failed; retrying", cause)),
      Effect.retry(offerRetry),
      Effect.orDie
    )
    return yield* DurableDeferred.await(deferred)
  }) as any

/** A take whose handler did not finish keeps its item: attempts never run out. */
const neverDrop = 2_147_483_647

/**
 * Runs `handler` for each item, `concurrency` at a time, for as long as the
 * worker runs. Each handler exit is recorded against the waiting run's
 * deferred. A handler that is interrupted records nothing, so the item is
 * delivered again. `concurrency` defaults to 1 and must be a positive
 * integer; another value is a defect when the worker starts.
 *
 * @category workers
 * @since 0.0.13
 */
export const makeWorker = <Payload extends Schema.Top, Success extends Schema.Top, Error extends Schema.Top, R>(
  queue: WorkQueue<Payload, Success, Error>,
  handler: (payload: Payload["Type"]) => Effect.Effect<Success["Type"], Error["Type"], R>,
  options: { readonly concurrency?: number | undefined } = {}
): Effect.Effect<
  never,
  never,
  | WorkflowEngine.WorkflowEngine
  | PersistedQueue.PersistedQueueFactory
  | R
  | Payload["DecodingServices"]
  | Success["EncodingServices"]
  | Error["EncodingServices"]
> =>
  Effect.gen(function*() {
    const concurrency = options.concurrency ?? 1
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      return yield* Effect.die(new RangeError(`WorkQueue ${queue.name}: concurrency must be a positive integer, not ${concurrency}`))
    }
    const any = queue as unknown as WorkQueue<Schema.Top, Success, Error>
    const persisted = yield* PersistedQueue.make({ name: queueName(any), schema: itemSchema(queue.payloadSchema), maxAttempts: neverDrop })
    const take = persisted.take((item, metadata) =>
      Effect.gen(function*() {
        const exit = yield* Effect.exit(handler(item.payload as Payload["Type"]))
        // Interruption alone is not an answer: fail the take, and the item is delivered again.
        if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
        yield* DurableDeferred.done(deferredOf(any, metadata.id), { token: item.token, exit })
      })
    ).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.logDebug(`WorkQueue ${queue.name}: a handler was interrupted; its item will be delivered again`)
          : Effect.logWarning(`WorkQueue ${queue.name}: an item will be delivered again`, cause)
      ),
      Effect.forever
    )
    yield* Effect.replicateEffect(take, concurrency, { concurrency, discard: true })
    return yield* Effect.never
  }) as any

/**
 * A layer that runs {@link makeWorker} for the life of its scope.
 *
 * @category workers
 * @since 0.0.13
 */
export const worker = <Payload extends Schema.Top, Success extends Schema.Top, Error extends Schema.Top, R>(
  queue: WorkQueue<Payload, Success, Error>,
  handler: (payload: Payload["Type"]) => Effect.Effect<Success["Type"], Error["Type"], R>,
  options: { readonly concurrency?: number | undefined } = {}
): Layer.Layer<
  never,
  never,
  | WorkflowEngine.WorkflowEngine
  | PersistedQueue.PersistedQueueFactory
  | R
  | Payload["DecodingServices"]
  | Success["EncodingServices"]
  | Error["EncodingServices"]
> => Layer.effectDiscard(Effect.forkScoped(makeWorker(queue, handler, options)))

/**
 * Effect's `PersistedQueue` over its memory store: items live in this
 * process. For items that survive it, provide `PersistedQueue.layer` with
 * Effect's `PersistedQueue.layerStoreSql()` or `layerStoreRedis()`.
 *
 * @category layers
 * @since 0.0.13
 */
export const memory: Layer.Layer<PersistedQueue.PersistedQueueFactory> = /* @__PURE__ */ PersistedQueue.layer.pipe(
  /* @__PURE__ */ Layer.provide(PersistedQueue.layerStoreMemory)
)

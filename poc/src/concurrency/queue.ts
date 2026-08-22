import {
  RuntimeValues,
  registerErrorCodec,
  type NominalError,
  type Optional,
  type Result,
} from "../runtime/index.ts";
import {
  Cancellation,
  Cancelled,
  cancellationError,
  onCancellation,
  type CancellationInput,
  type CancellationOptions,
  type CancellationRegistration,
} from "./cancellation.ts";

function reasonLabel(reason: unknown): string {
  if (typeof reason === "string" && reason.length > 0) return reason;
  if (reason instanceof Error && reason.message.length > 0) return reason.message;
  return "queue closed";
}

/** Expected failure produced after a Queue or Channel is shut down. */
export class QueueClosed extends Error {
  constructor(readonly reason: unknown = "queue closed") {
    super(reasonLabel(reason), reason instanceof Error ? { cause: reason } : undefined);
    this.name = "QueueClosed";
  }
}
export interface QueueClosed extends NominalError<"vibelang:QueueClosed@1"> {}

registerErrorCodec(QueueClosed, "vibelang:QueueClosed@1", {
  encode: (error) => ({ reason: reasonLabel(error.reason) }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 1 || typeof payload.reason !== "string"
    ) {
      throw new TypeError("invalid QueueClosed payload");
    }
    return new QueueClosed(payload.reason);
  },
});

export type QueueOperationError = QueueClosed | Cancelled;
export type QueueResult<Value> = Result<Value, QueueOperationError>;
export type QueueTryResult<Value> = Optional<Result<Value, QueueClosed>>;
export type QueueCancellation = CancellationInput | CancellationOptions;

interface TakeWaiter<Value> {
  active: boolean;
  registration?: CancellationRegistration;
  readonly resolve: (result: QueueResult<Value>) => void;
}

interface OfferWaiter<Value> {
  active: boolean;
  registration?: CancellationRegistration;
  readonly value: Value;
  readonly resolve: (result: QueueResult<void>) => void;
}

interface QueueState<Value> {
  readonly capacity: number;
  readonly items: Value[];
  readonly takers: TakeWaiter<Value>[];
  readonly offerers: OfferWaiter<Value>[];
  closed?: QueueClosed;
}

const queueStates = new WeakMap<object, QueueState<unknown>>();
const localQueues = new WeakSet<object>();

function stateOf<Value>(queue: Queue<Value>): QueueState<Value> {
  const state = queueStates.get(queue);
  if (!state || !localQueues.has(queue)) throw new TypeError("forged Queue value");
  return state as QueueState<Value>;
}

function validateCapacity(capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("Queue capacity must be a positive safe integer");
  }
}

function validateElement(value: unknown): void {
  if (value === null || value === undefined) {
    throw new TypeError("Queue cannot hold null or undefined because tryTake returns Optional");
  }
}

function cancellationFrom(options: QueueCancellation | undefined): CancellationInput | undefined {
  if (options === undefined) return undefined;
  if (options instanceof Cancellation || options instanceof AbortSignal) return options;
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Queue cancellation must be a Cancellation, AbortSignal, or options object");
  }
  const cancellation = options.cancellation;
  if (cancellation === undefined) return undefined;
  if (!(cancellation instanceof Cancellation) && !(cancellation instanceof AbortSignal)) {
    throw new TypeError("Queue cancellation must be a Cancellation or AbortSignal");
  }
  return cancellation;
}

function oldestActive<Waiter extends { active: boolean }>(waiters: Waiter[]): Waiter | undefined {
  while (waiters.length > 0) {
    const waiter = waiters.shift() as Waiter;
    if (waiter.active) return waiter;
  }
  return undefined;
}

function removeWaiter<Waiter>(waiters: Waiter[], target: Waiter): void {
  const index = waiters.indexOf(target);
  if (index >= 0) waiters.splice(index, 1);
}

function settleTake<Value>(waiter: TakeWaiter<Value>, result: QueueResult<Value>): void {
  if (!waiter.active) return;
  waiter.active = false;
  waiter.registration?.dispose();
  waiter.resolve(result);
}

function settleOffer<Value>(waiter: OfferWaiter<Value>, result: QueueResult<void>): void {
  if (!waiter.active) return;
  waiter.active = false;
  waiter.registration?.dispose();
  waiter.resolve(result);
}

function success<Value>(value: Value): Result<Value, never> {
  return RuntimeValues.success(value);
}

function failure<ErrorType extends Error>(error: ErrorType): Result<never, ErrorType> {
  return RuntimeValues.failure(error);
}

/** A bounded, FIFO, multi-producer/multi-consumer asynchronous queue. */
export class Queue<Value> {
  constructor(capacity: number) {
    validateCapacity(capacity);
    queueStates.set(this, {
      capacity,
      items: [],
      takers: [],
      offerers: [],
    });
    localQueues.add(this);
    Object.freeze(this);
  }

  static bounded<Value>(capacity: number): Queue<Value> {
    return new Queue<Value>(capacity);
  }

  static isQueue(value: unknown): value is Queue<unknown> {
    return typeof value === "object" && value !== null && localQueues.has(value);
  }

  get capacity(): number { return stateOf(this).capacity; }
  get size(): number { return stateOf(this).items.length; }
  get pendingTakers(): number { return stateOf(this).takers.filter((waiter) => waiter.active).length; }
  get pendingOfferers(): number { return stateOf(this).offerers.filter((waiter) => waiter.active).length; }
  get isShutdown(): boolean { return stateOf(this).closed !== undefined; }

  offer(value: Value, options?: QueueCancellation): Promise<QueueResult<void>> {
    validateElement(value);
    const cancellation = cancellationFrom(options);
    const state = stateOf(this);
    if (state.closed) return Promise.resolve(failure(state.closed));
    if (cancellation) {
      const cancelled = cancellationError(cancellation);
      if (cancelled) return Promise.resolve(failure(cancelled));
    }

    const taker = oldestActive(state.takers);
    if (taker) {
      settleTake(taker, success(value));
      return Promise.resolve(success(undefined));
    }
    if (state.items.length < state.capacity) {
      state.items.push(value);
      return Promise.resolve(success(undefined));
    }

    const pending = new Promise<QueueResult<void>>((resolve) => {
      const waiter: OfferWaiter<Value> = { active: true, value, resolve };
      state.offerers.push(waiter);
      if (cancellation) {
        waiter.registration = onCancellation(cancellation, (cancelled) => {
          if (!waiter.active) return;
          removeWaiter(state.offerers, waiter);
          settleOffer(waiter, failure(cancelled));
        });
      }
    });
    // Queue cancellation settles with a Result, but containing a defensive
    // observer here also protects against a hostile Promise subclass/host.
    void pending.catch(() => undefined);
    return pending;
  }

  /**
   * None means "full right now". Some contains the fallible operation result,
   * allowing shutdown to remain distinct from temporary backpressure.
   */
  tryOffer(value: Value): QueueTryResult<void> {
    validateElement(value);
    const state = stateOf(this);
    if (state.closed) return RuntimeValues.present(failure(state.closed));

    const taker = oldestActive(state.takers);
    if (taker) {
      settleTake(taker, success(value));
      return RuntimeValues.present(success(undefined));
    }
    if (state.items.length >= state.capacity) return RuntimeValues.absent();
    state.items.push(value);
    return RuntimeValues.present(success(undefined));
  }

  take(options?: QueueCancellation): Promise<QueueResult<Value>> {
    const cancellation = cancellationFrom(options);
    const state = stateOf(this);
    if (state.items.length > 0) {
      const value = state.items.shift() as Value;
      this.#admitOldestOfferer(state);
      return Promise.resolve(success(value));
    }
    if (state.closed) return Promise.resolve(failure(state.closed));
    if (cancellation) {
      const cancelled = cancellationError(cancellation);
      if (cancelled) return Promise.resolve(failure(cancelled));
    }

    const pending = new Promise<QueueResult<Value>>((resolve) => {
      const waiter: TakeWaiter<Value> = { active: true, resolve };
      state.takers.push(waiter);
      if (cancellation) {
        waiter.registration = onCancellation(cancellation, (cancelled) => {
          if (!waiter.active) return;
          removeWaiter(state.takers, waiter);
          settleTake(waiter, failure(cancelled));
        });
      }
    });
    void pending.catch(() => undefined);
    return pending;
  }

  /** None means "empty right now"; Some(Error) reports permanent shutdown. */
  tryTake(): QueueTryResult<Value> {
    const state = stateOf(this);
    if (state.items.length > 0) {
      const value = state.items.shift() as Value;
      this.#admitOldestOfferer(state);
      return RuntimeValues.present(success(value));
    }
    if (state.closed) return RuntimeValues.present(failure(state.closed));
    return RuntimeValues.absent();
  }

  shutdown(reason: unknown = "queue closed"): boolean {
    const state = stateOf(this);
    if (state.closed) return false;
    const closed = new QueueClosed(reason);
    state.closed = closed;

    for (const taker of state.takers.splice(0)) settleTake(taker, failure(closed));
    for (const offerer of state.offerers.splice(0)) settleOffer(offerer, failure(closed));
    return true;
  }

  #admitOldestOfferer(state: QueueState<Value>): void {
    const offerer = oldestActive(state.offerers);
    if (!offerer) return;

    const taker = oldestActive(state.takers);
    if (taker) settleTake(taker, success(offerer.value));
    else state.items.push(offerer.value);
    settleOffer(offerer, success(undefined));
  }
}

export function isQueue(value: unknown): value is Queue<unknown> {
  return Queue.isQueue(value);
}

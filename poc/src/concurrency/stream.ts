import {
  RuntimeValues,
  UnhandledException,
  __vsInspectResult,
  isLocalError,
  isPanic,
  type Result,
} from "../runtime/index.ts";
import { Governor, governorFrom, type ConcurrencyBound } from "./governor.ts";
import { mapUnordered, type Awaitable } from "./join.ts";
import { type Dispatch, dispatchVia, Scheduler } from "./scheduler.ts";
import {
  Cancellation,
  CancellationSource,
  Cancelled,
  onCancellation,
  type CancellationInput,
  type CancellationOptions,
} from "./cancellation.ts";
import { Queue, QueueClosed } from "./queue.ts";

type IteratorFactory<Value> = () => AsyncIterator<Value>;

interface StreamState<Value> {
  readonly iterator: IteratorFactory<Value>;
}

const streamStates = new WeakMap<object, StreamState<unknown>>();
const localStreams = new WeakSet<object>();

function stateOf<Value>(stream: Stream<Value, Error>): StreamState<Value> {
  const state = streamStates.get(stream);
  if (!state || !localStreams.has(stream)) throw new TypeError("forged Stream value");
  return state as StreamState<Value>;
}

function validateCount(count: number, label: string): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function asyncIteratorFromSync<Value>(iterator: Iterator<Value>): AsyncIterator<Value> {
  return {
    next: async () => iterator.next(),
    return: iterator.return ? async (value?: unknown) => iterator.return!(value) : undefined,
    throw: iterator.throw ? async (error?: unknown) => iterator.throw!(error) : undefined,
  };
}

function requireAsyncIterator<Value>(value: unknown, label: string): AsyncIterator<Value> {
  if (typeof value !== "object" || value === null || typeof (value as AsyncIterator<Value>).next !== "function") {
    throw new TypeError(`${label} must produce an AsyncIterator`);
  }
  return value as AsyncIterator<Value>;
}

function requireIterable<Value>(values: Iterable<Value>, label: string): void {
  const kind = typeof values;
  if ((kind !== "object" && kind !== "function" && kind !== "string") || values === null) {
    throw new TypeError(`${label} requires an Iterable`);
  }
  if (typeof values[Symbol.iterator] !== "function") throw new TypeError(`${label} requires an Iterable`);
}

function requireAsyncIterable<Value>(values: AsyncIterable<Value>, label: string): void {
  const kind = typeof values;
  if ((kind !== "object" && kind !== "function") || values === null) {
    throw new TypeError(`${label} requires an AsyncIterable`);
  }
  if (typeof values[Symbol.asyncIterator] !== "function") throw new TypeError(`${label} requires an AsyncIterable`);
}

function makeStream<Value, Failure extends Error>(factory: IteratorFactory<Value>): Stream<Value, Failure> {
  return new LocalStream<Value, Failure>(factory);
}

function cancellationFrom(
  options: CancellationInput | CancellationOptions | undefined,
  label: string,
): CancellationInput | undefined {
  if (options === undefined) return undefined;
  if (options instanceof Cancellation || options instanceof AbortSignal) return options;
  if (typeof options !== "object" || options === null) {
    throw new TypeError(`${label} cancellation must be a Cancellation, AbortSignal, or options object`);
  }
  const cancellation = options.cancellation;
  if (cancellation === undefined) return undefined;
  if (!(cancellation instanceof Cancellation) && !(cancellation instanceof AbortSignal)) {
    throw new TypeError(`${label} cancellation must be a Cancellation or AbortSignal`);
  }
  return cancellation;
}

function expectedError(error: unknown): Error {
  if (isPanic(error)) throw error;
  return isLocalError(error) ? error : new UnhandledException(error);
}

export interface StreamMapConcurrentOptions {
  readonly concurrency: ConcurrencyBound;
  readonly cancellation?: CancellationInput;
}

export type StreamRunOptions = CancellationInput | CancellationOptions;
export type StreamRunError<Failure extends Error> = Failure | Cancelled | UnhandledException;

type PullCompletion<Value> =
  | { readonly kind: "next"; readonly next: IteratorResult<Value> }
  | { readonly kind: "error"; readonly error: unknown };

/**
 * A source pull that loses to cancellation.
 *
 * This WAS a race spelled by hand — a `new Promise` plus a first-wins
 * `complete` — rather than a `Promise.race`, which is worth saying out loud
 * because a migration driven by grepping for `Promise.race` finds the two in
 * `join.ts` and the one in `async-iterators.ts` and silently leaves this one
 * behind. It is the same arrival-order decision as those three and it is
 * journalled like them.
 */
function cancellablePull<Value>(
  iterator: AsyncIterator<Value>,
  cancellation: Cancellation,
  dispatch: Dispatch,
): Promise<PullCompletion<Value>> {
  let registration: ReturnType<typeof onCancellation> | undefined;
  // Both settlements are folded into the value channel, so this never rejects
  // and a late source rejection stays contained however the race lands.
  const raw = Promise.resolve()
    .then(() => iterator.next())
    .then(
      (next): PullCompletion<Value> => ({ kind: "next", next }),
      (error): PullCompletion<Value> => ({ kind: "error", error }),
    );
  const stopped = new Promise<PullCompletion<Value>>((resolve) => {
    registration = onCancellation(cancellation, (error) => resolve({ kind: "error", error }));
  });
  return dispatch
    .firstReady<PullCompletion<Value>>("Stream.pull", [
      dispatch.start("Stream.pull.source", () => raw),
      dispatch.start("Stream.pull.stop", () => stopped),
    ])
    // Disposal on either outcome, which is what the hand-rolled `settled` flag
    // was for: a listener left on the token would accumulate per pull.
    .finally(() => registration?.dispose());
}

interface BufferProducerOutcome {
  readonly error?: unknown;
  readonly cleanupError?: unknown;
}

async function* buffered<Value>(
  source: Stream<Value, Error>,
  capacity: number,
  dispatch: Dispatch,
): AsyncGenerator<Value> {
  const queue = new Queue<Value>(capacity);
  const stop = new CancellationSource();
  const iterator = source[Symbol.asyncIterator]();
  let sourceDone = false;
  let stopping = false;

  const producer = (async (): Promise<BufferProducerOutcome> => {
    let primaryError: unknown;
    let cleanupError: unknown;
    try {
      while (true) {
        const pull = await cancellablePull(iterator, stop, dispatch);
        if (pull.kind === "error") throw pull.error;
        if (pull.next.done) {
          sourceDone = true;
          break;
        }
        const offered = __vsInspectResult(await queue.offer(pull.next.value, stop));
        if (!offered.ok) throw offered.error;
      }
    } catch (error) {
      if (!(stopping && (error instanceof Cancelled || error instanceof QueueClosed))) {
        primaryError = error;
      }
    } finally {
      if (!sourceDone && iterator.return) {
        try {
          await iterator.return();
        } catch (error) {
          cleanupError = error;
        }
      }
      queue.shutdown(primaryError ?? cleanupError ?? "stream buffer completed");
    }
    return {
      ...(primaryError === undefined ? {} : { error: primaryError }),
      ...(cleanupError === undefined ? {} : { cleanupError }),
    };
  })();
  // A producer reports through a value outcome, but retain an observer in case
  // a hostile thenable or host operation violates that containment boundary.
  void producer.catch(() => undefined);

  let completed = false;
  let primaryFailure = false;
  try {
    while (true) {
      const taken = __vsInspectResult(await queue.take());
      if (taken.ok) {
        yield taken.value;
        continue;
      }
      if (!(taken.error instanceof QueueClosed)) throw taken.error;
      const outcome = await producer;
      if (outcome.error !== undefined) throw outcome.error;
      if (outcome.cleanupError !== undefined) throw outcome.cleanupError;
      completed = true;
      return;
    }
  } catch (error) {
    primaryFailure = true;
    throw error;
  } finally {
    if (!completed) {
      stopping = true;
      stop.cancel("stream buffer iteration closed");
      queue.shutdown("stream buffer iteration closed");
    }
    const outcome = await producer;
    stop.unlink();
    if (!primaryFailure && outcome.cleanupError !== undefined) throw outcome.cleanupError;
  }
}

/** A frozen, lazy, pull-based stream backed by a fresh AsyncIterator per run. */
export abstract class Stream<Value, Failure extends Error = Error> implements AsyncIterable<Value> {
  static fromIterable<Value, Failure extends Error = Error>(values: Iterable<Value>): Stream<Value, Failure> {
    return fromIterable<Value, Failure>(values);
  }

  static fromAsyncIterable<Value, Failure extends Error = Error>(
    values: AsyncIterable<Value>,
  ): Stream<Value, Failure> {
    return fromAsyncIterable<Value, Failure>(values);
  }

  static of<const Values extends readonly unknown[]>(...values: Values): Stream<Values[number], never> {
    return of(...values);
  }

  static isStream(value: unknown): value is Stream<unknown, Error> {
    return typeof value === "object" && value !== null && localStreams.has(value);
  }

  [Symbol.asyncIterator](): AsyncIterator<Value> {
    const iterator = stateOf(this as unknown as Stream<Value, Error>).iterator();
    return requireAsyncIterator<Value>(iterator, "Stream iterator factory");
  }

  map<Output>(project: (value: Value) => Awaitable<Output>): Stream<Output, Failure> {
    if (typeof project !== "function") throw new TypeError("Stream.map requires a function");
    const source = this;
    return makeStream<Output, Failure>(() => (async function* () {
      for await (const value of source) yield await project(value);
    })());
  }

  filter(predicate: (value: Value) => Awaitable<unknown>): Stream<Value, Failure> {
    if (typeof predicate !== "function") throw new TypeError("Stream.filter requires a function");
    const source = this;
    return makeStream<Value, Failure>(() => (async function* () {
      for await (const value of source) {
        if (await predicate(value)) yield value;
      }
    })());
  }

  take(count: number): Stream<Value, Failure> {
    validateCount(count, "Stream.take count");
    const source = this;
    return makeStream<Value, Failure>(() => (async function* () {
      if (count === 0) return;
      let seen = 0;
      for await (const value of source) {
        yield value;
        seen += 1;
        if (seen >= count) return;
      }
    })());
  }

  drop(count: number): Stream<Value, Failure> {
    validateCount(count, "Stream.drop count");
    const source = this;
    return makeStream<Value, Failure>(() => (async function* () {
      let seen = 0;
      for await (const value of source) {
        if (seen < count) {
          seen += 1;
          continue;
        }
        yield value;
      }
    })());
  }

  scan<Accumulator>(
    initial: Accumulator,
    reducer: (accumulator: Accumulator, value: Value) => Awaitable<Accumulator>,
  ): Stream<Accumulator, Failure> {
    if (typeof reducer !== "function") throw new TypeError("Stream.scan requires a reducer function");
    const source = this;
    return makeStream<Accumulator, Failure>(() => (async function* () {
      let accumulator = initial;
      for await (const value of source) {
        accumulator = await reducer(accumulator, value);
        yield accumulator;
      }
    })());
  }

  mapConcurrent<Output>(
    project: (value: Value, cancellation: Cancellation) => Awaitable<Output>,
    boundOrOptions: ConcurrencyBound | StreamMapConcurrentOptions,
  ): Stream<Output, Failure> {
    if (typeof project !== "function") throw new TypeError("Stream.mapConcurrent requires a function");
    const direct = typeof boundOrOptions === "number" || boundOrOptions instanceof Governor;
    const options = direct ? undefined : boundOrOptions as StreamMapConcurrentOptions;
    if (!direct && (typeof options !== "object" || options === null)) {
      throw new TypeError("Stream.mapConcurrent requires a concurrency bound or options");
    }
    const concurrency = direct ? boundOrOptions as ConcurrencyBound : options!.concurrency;
    governorFrom(concurrency, "Stream.mapConcurrent concurrency");
    if (options?.cancellation !== undefined) {
      cancellationFrom(options.cancellation, "Stream.mapConcurrent");
    }
    const source = this;

    return makeStream<Output, Failure>(() => (async function* () {
      let linked: CancellationSource | undefined;
      const requested = options?.cancellation;
      const cancellation = requested instanceof AbortSignal
        ? (linked = new CancellationSource(requested))
        : requested;
      try {
        const mapped = cancellation
          ? mapUnordered(source, project, { concurrency, cancellation })
          : mapUnordered(source, project, concurrency);
        for await (const value of mapped) yield value;
      } finally {
        linked?.unlink();
      }
    })());
  }

  buffer(queueCapacity: number): Stream<Value, Failure> {
    // Queue performs the authoritative positive-capacity validation now, so a
    // malformed stream fails at combinator construction rather than first pull.
    const validation = new Queue<Value>(queueCapacity);
    validation.shutdown("capacity validation");
    const source = this as unknown as Stream<Value, Error>;
    // Resolved at combinator CONSTRUCTION, like `mapConcurrent` resolves its
    // cancellation: `makeStream`'s factory runs at iteration time, by which
    // point the enclosing Layer has been left.
    const dispatch = dispatchVia(Scheduler.context());
    return makeStream<Value, Failure>(() => buffered(source, queueCapacity, dispatch));
  }

  interrupt(cancellation: CancellationInput): Stream<Value, Failure | Cancelled> {
    if (!(cancellation instanceof Cancellation) && !(cancellation instanceof AbortSignal)) {
      throw new TypeError("Stream.interrupt requires a Cancellation or AbortSignal");
    }
    const source = this;
    // Resolved HERE, not in the generator below: that body runs at drive time,
    // outside the Layer this method was called in.
    const scheduler = Scheduler.context();
    return makeStream<Value, Failure | Cancelled>(() => (async function* () {
      let linked: CancellationSource | undefined;
      const parent = cancellation instanceof AbortSignal
        ? (linked = new CancellationSource(cancellation))
        : cancellation;
      try {
        for await (const value of mapUnordered(source, async (item) => item, {
          concurrency: 1,
          cancellation: parent,
          scheduler,
        })) yield value;
      } finally {
        linked?.unlink();
      }
    })());
  }

  async runCollect(options?: StreamRunOptions): Promise<Result<readonly Value[], StreamRunError<Failure>>> {
    const values: Value[] = [];
    const result = await this.runForEach((value) => { values.push(value); }, options);
    return result.map(() => Object.freeze(values));
  }

  async runForEach(
    consumer: (value: Value) => Awaitable<unknown>,
    options?: StreamRunOptions,
  ): Promise<Result<void, StreamRunError<Failure>>> {
    if (typeof consumer !== "function") {
      throw new TypeError("Stream.runForEach requires a consumer function");
    }
    try {
      const cancellation = cancellationFrom(options, "Stream.runForEach");
      const source = cancellation ? this.interrupt(cancellation) : this;
      for await (const value of source) await consumer(value);
      return RuntimeValues.success(undefined);
    } catch (error) {
      return RuntimeValues.failure(expectedError(error)) as Result<never, StreamRunError<Failure>>;
    }
  }

  async runFold<Accumulator>(
    initial: Accumulator,
    reducer: (accumulator: Accumulator, value: Value) => Awaitable<Accumulator>,
    options?: StreamRunOptions,
  ): Promise<Result<Accumulator, StreamRunError<Failure>>> {
    if (typeof reducer !== "function") throw new TypeError("Stream.runFold requires a reducer function");
    let accumulator = initial;
    const result = await this.runForEach(async (value) => {
      accumulator = await reducer(accumulator, value);
    }, options);
    return result.map(() => accumulator);
  }
}

class LocalStream<Value, Failure extends Error> extends Stream<Value, Failure> {
  constructor(factory: IteratorFactory<Value>) {
    super();
    streamStates.set(this, { iterator: factory as IteratorFactory<unknown> });
    localStreams.add(this);
    Object.freeze(this);
  }
}

export function fromIterable<Value, Failure extends Error = Error>(
  values: Iterable<Value>,
): Stream<Value, Failure> {
  requireIterable(values, "Stream.fromIterable");
  return makeStream<Value, Failure>(() => asyncIteratorFromSync(values[Symbol.iterator]()));
}

export function fromAsyncIterable<Value, Failure extends Error = Error>(
  values: AsyncIterable<Value>,
): Stream<Value, Failure> {
  requireAsyncIterable(values, "Stream.fromAsyncIterable");
  return makeStream<Value, Failure>(() => requireAsyncIterator(values[Symbol.asyncIterator](), "Stream.fromAsyncIterable"));
}

export function of<const Values extends readonly unknown[]>(...values: Values): Stream<Values[number], never> {
  return fromIterable<Values[number], never>(Object.freeze([...values]));
}

export function isStream(value: unknown): value is Stream<unknown, Error> {
  return Stream.isStream(value);
}

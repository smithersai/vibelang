import { VibeFailure } from "../runtime/failure.ts";

export class Cancelled extends VibeFailure {
  declare readonly _tag: "Cancelled";
  constructor(readonly reason: unknown = "cancelled") {
    super("Cancelled");
    this.message = typeof reason === "string" ? reason : "cancelled";
  }
}

/** Cancellation is a capability; callers can supply one through their Layer. */
export class Cancellation {
  readonly #controller = new AbortController();
  get signal(): AbortSignal { return this.#controller.signal; }
  cancel(reason?: unknown): void { this.#controller.abort(reason); }
  check(): void {
    if (this.signal.aborted) throw new Cancelled(this.signal.reason);
  }
}

class Semaphore {
  #available: number;
  readonly #waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    abort?: () => void;
  }> = [];
  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("TaskScope limit must be a positive integer");
    this.#available = limit;
  }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new Cancelled(signal.reason);
    if (this.#available === 0) await new Promise<void>((resolve, reject) => {
      const waiter: {
        resolve: () => void;
        reject: (error: unknown) => void;
        signal?: AbortSignal;
        abort?: () => void;
      } = { resolve, reject, signal };
      if (signal) {
        waiter.abort = () => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(new Cancelled(signal.reason));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      this.#waiters.push(waiter);
    });
    else this.#available--;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.#waiters.shift();
      if (waiter) {
        if (waiter.signal && waiter.abort) waiter.signal.removeEventListener("abort", waiter.abort);
        waiter.resolve();
      } else this.#available++;
    };
  }
}

/** Bounded structured concurrency implemented with ordinary promises, not fibers. */
export class TaskScope implements AsyncDisposable {
  readonly cancellation: Cancellation;
  readonly #semaphore: Semaphore;
  readonly #tasks = new Set<Promise<unknown>>();
  #closed = false;

  private constructor(limit: number, cancellation: Cancellation) {
    this.#semaphore = new Semaphore(limit);
    this.cancellation = cancellation;
  }

  static bounded(limit: number, cancellation = new Cancellation()): TaskScope {
    return new TaskScope(limit, cancellation);
  }

  run<T>(task: (cancellation: Cancellation) => Promise<T> | T): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("TaskScope is closed"));
    const pending = (async () => {
      const release = await this.#semaphore.acquire(this.cancellation.signal);
      try {
        this.cancellation.check();
        return await task(this.cancellation);
      } finally {
        release();
      }
    })();
    this.#tasks.add(pending);
    // Retain settled children until close so an unawaited early failure cannot
    // disappear from the owning scope. This handler only prevents process-level
    // unhandled-rejection noise; close still observes the original exit.
    void pending.catch(() => undefined);
    return pending;
  }

  async close(options: { cancel?: boolean } = {}): Promise<void> {
    this.#closed = true;
    if (options.cancel) this.cancellation.cancel("scope closed");
    const exits = await Promise.allSettled([...this.#tasks]);
    this.#tasks.clear();
    const failure = exits.find((exit): exit is PromiseRejectedResult => exit.status === "rejected");
    if (failure) throw failure.reason;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close({ cancel: true });
  }
}

export async function awaitAll<const Values extends readonly unknown[]>(
  ...values: Values
): Promise<{ -readonly [Index in keyof Values]: Awaited<Values[Index]> }> {
  return Promise.all(values) as Promise<{ -readonly [Index in keyof Values]: Awaited<Values[Index]> }>;
}

/** Bounded, completion-order async mapping (the TC39 unordered direction). */
export async function* mapUnordered<Input, Output>(
  inputs: Iterable<Input>,
  limit: number,
  mapper: (input: Input, cancellation: Cancellation) => Promise<Output>,
  cancellation = new Cancellation(),
): AsyncGenerator<Output> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("mapUnordered limit must be a positive integer");
  const iterator = inputs[Symbol.iterator]();
  const active = new Map<number, Promise<{ token: number; value: Output }>>();
  let token = 0;
  const start = () => {
    const next = iterator.next();
    if (next.done) return false;
    const current = token++;
    active.set(current, Promise.resolve(mapper(next.value, cancellation)).then((value) => ({ token: current, value })));
    return true;
  };
  let completedNormally = false;
  try {
    while (active.size < limit && start()) { /* fill */ }
    while (active.size > 0) {
      cancellation.check();
      let onAbort: (() => void) | undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Cancelled(cancellation.signal.reason));
        cancellation.signal.addEventListener("abort", onAbort, { once: true });
      });
      let completed: { token: number; value: Output };
      try {
        completed = await Promise.race([...active.values(), cancelled]);
      } finally {
        if (onAbort) cancellation.signal.removeEventListener("abort", onAbort);
      }
      active.delete(completed.token);
      start();
      yield completed.value;
    }
    completedNormally = true;
  } finally {
    if (!completedNormally) cancellation.cancel("unordered iteration closed");
    await Promise.allSettled(active.values());
    iterator.return?.();
  }
}

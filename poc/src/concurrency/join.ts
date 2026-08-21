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

/** Tuple-preserving parallel join used to spike the `await.all` type surface. */
export async function awaitAll<const Values extends readonly unknown[]>(
  ...values: Values
): Promise<{ -readonly [Index in keyof Values]: Awaited<Values[Index]> }> {
  return Promise.all(values) as Promise<{ -readonly [Index in keyof Values]: Awaited<Values[Index]> }>;
}

/** Completion-order async mapping, following TC39's concurrency-control direction. */
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

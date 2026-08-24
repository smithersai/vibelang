import {
  Cancellation,
  Cancelled,
  cancellationError,
  onCancellation,
  type CancellationInput,
  type CancellationOptions,
  type CancellationRegistration,
} from "./cancellation.ts";

export type SemaphoreCancellation = CancellationInput | CancellationOptions;

interface PermitState {
  released: boolean;
  readonly release: () => void;
}

const permitStates = new WeakMap<object, PermitState>();
const localPermits = new WeakSet<object>();

function permitState(permit: SemaphorePermit): PermitState {
  const state = permitStates.get(permit);
  if (!state || !localPermits.has(permit)) throw new TypeError("forged SemaphorePermit value");
  return state;
}

/** Frozen, non-forgeable ownership of one Semaphore slot. */
export abstract class SemaphorePermit {
  release(): void {
    const state = permitState(this);
    if (state.released) return;
    state.released = true;
    state.release();
  }

  [Symbol.dispose](): void {
    this.release();
  }

  get released(): boolean {
    return permitState(this).released;
  }
}

class LocalSemaphorePermit extends SemaphorePermit {
  constructor(release: () => void) {
    super();
    permitStates.set(this, { released: false, release });
    localPermits.add(this);
    Object.freeze(this);
  }
}

export function isSemaphorePermit(value: unknown): value is SemaphorePermit {
  return typeof value === "object" && value !== null && localPermits.has(value);
}

interface Waiter {
  active: boolean;
  registration?: CancellationRegistration;
  readonly resolve: (permit: SemaphorePermit) => void;
  readonly reject: (error: Cancelled) => void;
}

interface SemaphoreState {
  readonly size: number;
  active: number;
  readonly waiters: Waiter[];
}

const semaphoreStates = new WeakMap<object, SemaphoreState>();
const localSemaphores = new WeakSet<object>();

function stateOf(semaphore: Semaphore): SemaphoreState {
  const state = semaphoreStates.get(semaphore);
  if (!state || !localSemaphores.has(semaphore)) throw new TypeError("forged Semaphore value");
  return state;
}

function validateSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError("Semaphore size must be a positive safe integer");
  }
}

function cancellationFrom(options: SemaphoreCancellation | undefined): CancellationInput | undefined {
  if (options === undefined) return undefined;
  if (options instanceof Cancellation || options instanceof AbortSignal) return options;
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Semaphore cancellation must be a Cancellation, AbortSignal, or options object");
  }
  const cancellation = options.cancellation;
  if (cancellation === undefined) return undefined;
  if (!(cancellation instanceof Cancellation) && !(cancellation instanceof AbortSignal)) {
    throw new TypeError("Semaphore cancellation must be a Cancellation or AbortSignal");
  }
  return cancellation;
}

function removeWaiter(waiters: Waiter[], target: Waiter): void {
  const index = waiters.indexOf(target);
  if (index >= 0) waiters.splice(index, 1);
}

/** A cancellation-aware FIFO counting semaphore. */
export class Semaphore {
  constructor(size: number) {
    validateSize(size);
    semaphoreStates.set(this, { size, active: 0, waiters: [] });
    localSemaphores.add(this);
    Object.freeze(this);
  }

  static withPermits(size: number): Semaphore {
    return new Semaphore(size);
  }

  static isSemaphore(value: unknown): value is Semaphore {
    return typeof value === "object" && value !== null && localSemaphores.has(value);
  }

  get size(): number { return stateOf(this).size; }
  get activeCount(): number { return stateOf(this).active; }
  get availableCount(): number { return stateOf(this).size - stateOf(this).active; }
  get pendingCount(): number { return stateOf(this).waiters.filter((waiter) => waiter.active).length; }

  acquire(options?: SemaphoreCancellation): Promise<SemaphorePermit> {
    const cancellation = cancellationFrom(options);
    if (cancellation) {
      const cancelled = cancellationError(cancellation);
      if (cancelled) {
        const rejected = Promise.reject<SemaphorePermit>(cancelled);
        void rejected.catch(() => undefined);
        return rejected;
      }
    }

    const state = stateOf(this);
    if (state.active < state.size && state.waiters.length === 0) {
      state.active += 1;
      return Promise.resolve(this.#permit());
    }

    const pending = new Promise<SemaphorePermit>((resolve, reject) => {
      const waiter: Waiter = { active: true, resolve, reject };
      state.waiters.push(waiter);
      if (cancellation) {
        waiter.registration = onCancellation(cancellation, (cancelled) => {
          if (!waiter.active) return;
          waiter.active = false;
          removeWaiter(state.waiters, waiter);
          waiter.registration?.dispose();
          reject(cancelled);
        });
      }
    });
    // Public cancellation still rejects this exact Promise; this observer only
    // prevents a caller delay from becoming a process-level unhandled event.
    void pending.catch(() => undefined);
    return pending;
  }

  /** `undefined` when no permit is free right now — ordinary absence, no container. */
  tryAcquire(): SemaphorePermit | undefined {
    const state = stateOf(this);
    if (state.active >= state.size || state.waiters.length > 0) return undefined;
    state.active += 1;
    return this.#permit();
  }

  withPermit<Output>(
    operation: () => Output | PromiseLike<Output>,
    options?: SemaphoreCancellation,
  ): Promise<Awaited<Output>> {
    if (typeof operation !== "function") {
      const rejected = Promise.reject<Awaited<Output>>(new TypeError("Semaphore.withPermit requires a function"));
      void rejected.catch(() => undefined);
      return rejected;
    }
    const execution = this.#withPermit(operation, options);
    void execution.catch(() => undefined);
    return execution;
  }

  async #withPermit<Output>(
    operation: () => Output | PromiseLike<Output>,
    options: SemaphoreCancellation | undefined,
  ): Promise<Awaited<Output>> {
    const permit = await this.acquire(options);
    try {
      return await operation() as Awaited<Output>;
    } finally {
      permit.release();
    }
  }

  #permit(): SemaphorePermit {
    return new LocalSemaphorePermit(() => this.#release());
  }

  #release(): void {
    const state = stateOf(this);
    if (state.active < 1) throw new Error("Semaphore permit accounting underflow");
    state.active -= 1;

    let waiter: Waiter | undefined;
    while (state.waiters.length > 0 && waiter === undefined) {
      const candidate = state.waiters.shift() as Waiter;
      if (candidate.active) waiter = candidate;
    }
    if (!waiter) return;

    waiter.active = false;
    waiter.registration?.dispose();
    // Reserve before resolving, so reentrant acquisition cannot jump the FIFO.
    state.active += 1;
    waiter.resolve(this.#permit());
  }
}

export function isSemaphore(value: unknown): value is Semaphore {
  return Semaphore.isSemaphore(value);
}

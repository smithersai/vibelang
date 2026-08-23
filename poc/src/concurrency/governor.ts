export interface GovernorPermit {
  /** Idempotently return this permit to its governor. */
  release(): void;
}

interface Waiter {
  readonly resolve: (permit: GovernorPermit) => void;
}

class Permit implements GovernorPermit {
  #released = false;

  constructor(private readonly releaseSlot: () => void) {}

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.releaseSlot();
  }
}

/**
 * A FIFO counting governor. It limits admission only: callers and structured
 * combinators remain responsible for cancellation and child-task lifetimes.
 */
export class Governor {
  readonly #limit: number;
  readonly #waiters: Waiter[] = [];
  #active = 0;

  private constructor(limit: number) {
    this.#limit = limit;
  }

  static withLimit(limit: number): Governor {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Governor limit must be a positive safe integer");
    }
    return new Governor(limit);
  }

  get limit(): number { return this.#limit; }
  get activeCount(): number { return this.#active; }
  get pendingCount(): number { return this.#waiters.length; }

  acquire(): Promise<GovernorPermit> {
    if (this.#active < this.#limit && this.#waiters.length === 0) {
      this.#active += 1;
      return Promise.resolve(this.#permit());
    }
    return new Promise((resolve) => {
      this.#waiters.push({ resolve });
    });
  }

  run<Output>(operation: () => Output | PromiseLike<Output>): Promise<Awaited<Output>> {
    const execution = this.#run(operation);
    // The returned Promise keeps its original rejection, but the governor's
    // bookkeeping never creates a process-level unhandled rejection if a host
    // abandons it. Smithers's checker still requires callers to consume it.
    void execution.catch(() => undefined);
    return execution;
  }

  async #run<Output>(operation: () => Output | PromiseLike<Output>): Promise<Awaited<Output>> {
    if (typeof operation !== "function") throw new TypeError("Governor.run requires a function");
    const permit = await this.acquire();
    try {
      return await operation() as Awaited<Output>;
    } finally {
      permit.release();
    }
  }

  #permit(): GovernorPermit {
    return new Permit(() => this.#release());
  }

  #release(): void {
    if (this.#active < 1) throw new Error("Governor permit accounting underflow");
    this.#active -= 1;
    const waiter = this.#waiters.shift();
    if (!waiter) return;

    // Reserve the slot before resolving the oldest waiter. Promise callbacks
    // run in a later microtask, so a callback that acquires again cannot jump
    // ahead of waiters or recursively enter release bookkeeping.
    this.#active += 1;
    waiter.resolve(this.#permit());
  }
}

export type ConcurrencyBound = number | Governor;

export function governorFrom(bound: ConcurrencyBound, label: string): Governor {
  if (bound instanceof Governor) return bound;
  try {
    return Governor.withLimit(bound);
  } catch (cause) {
    throw new RangeError(`${label} must be a Governor or positive integer within the safe range`, { cause });
  }
}

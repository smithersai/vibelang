import type { NominalError, Result } from "../runtime/index.ts";
import { RuntimeValues } from "../runtime/index.ts";
import {
  Cancellation as JoinCancellation,
  Cancelled as JoinCancelled,
} from "./join.ts";

/**
 * Cancellation deliberately reuses join.ts's constructor and Error identity.
 * A second class named Cancellation or Cancelled would split `instanceof`,
 * capability lookup, and the registered wire codec into incompatible worlds.
 */
export { JoinCancellation as Cancellation, JoinCancelled as Cancelled };

declare module "./join.ts" {
  interface Cancelled extends NominalError<"vibelang:Cancelled@1"> {}
}

export type CancellationInput = JoinCancellation | AbortSignal;

export interface CancellationOptions {
  readonly cancellation?: CancellationInput;
}

interface RegistrationState {
  active: boolean;
  readonly dispose: () => void;
}

const registrationStates = new WeakMap<object, RegistrationState>();
const localRegistrations = new WeakSet<object>();

function registrationState(registration: CancellationRegistration): RegistrationState {
  const state = registrationStates.get(registration);
  if (!state || !localRegistrations.has(registration)) {
    throw new TypeError("forged CancellationRegistration value");
  }
  return state;
}

/** A frozen, idempotent handle for removing a cancellation listener. */
export abstract class CancellationRegistration {
  dispose(): void {
    const state = registrationState(this);
    if (!state.active) return;
    state.active = false;
    state.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  get active(): boolean {
    return registrationState(this).active;
  }
}

class LocalCancellationRegistration extends CancellationRegistration {
  constructor(dispose: () => void, active = true) {
    super();
    registrationStates.set(this, { active, dispose });
    localRegistrations.add(this);
    Object.freeze(this);
  }
}

export function isCancellationRegistration(value: unknown): value is CancellationRegistration {
  return typeof value === "object" && value !== null && localRegistrations.has(value);
}

function inertRegistration(): CancellationRegistration {
  return new LocalCancellationRegistration(() => {}, false);
}

function requireHandler(handler: unknown): asserts handler is (cancelled: JoinCancelled) => void {
  if (typeof handler !== "function") throw new TypeError("Cancellation.onCancel requires a handler function");
}

function runHandler(handler: (cancelled: JoinCancelled) => void, cancelled: JoinCancelled): void {
  // Cancellation listeners are observers, not child tasks. A listener failure
  // cannot make AbortController.dispatchEvent throw later as an uncaught host
  // exception or prevent sibling listeners from observing cancellation.
  try {
    handler(cancelled);
  } catch {
    // Deliberately contained. Work that can fail belongs in an awaited task.
  }
}

function signalOfCancellation(cancellation: JoinCancellation): AbortSignal {
  const signal = cancellation.signal as AbortSignal | (AbortSignal & (() => AbortSignal));
  return typeof signal === "function" ? signal() : signal;
}

export function cancellationSignal(input: CancellationInput): AbortSignal {
  if (input instanceof JoinCancellation) return signalOfCancellation(input);
  if (input instanceof AbortSignal) return input;
  throw new TypeError("cancellation must be a Cancellation or AbortSignal");
}

export function cancellationError(input: CancellationInput): JoinCancelled | undefined {
  const signal = cancellationSignal(input);
  return signal.aborted ? new JoinCancelled(signal.reason) : undefined;
}

export function cancellationCheckpoint(input: CancellationInput): Result<void, JoinCancelled> {
  const error = cancellationError(input);
  return error ? RuntimeValues.failure(error) : RuntimeValues.success(undefined);
}

export function onCancellation(
  input: CancellationInput,
  handler: (cancelled: JoinCancelled) => void,
): CancellationRegistration {
  requireHandler(handler);
  const signal = cancellationSignal(input);
  if (signal.aborted) {
    runHandler(handler, new JoinCancelled(signal.reason));
    return inertRegistration();
  }

  let registration!: LocalCancellationRegistration;
  const listener = () => {
    const state = registrationState(registration);
    if (!state.active) return;
    state.active = false;
    signal.removeEventListener("abort", listener);
    runHandler(handler, new JoinCancelled(signal.reason));
  };
  registration = new LocalCancellationRegistration(() => signal.removeEventListener("abort", listener));
  signal.addEventListener("abort", listener, { once: true });
  // Abort can race listener installation in host implementations. Recheck so
  // an observer is never stranded after registering against an aborted signal.
  if (signal.aborted) listener();
  return registration;
}

declare module "./join.ts" {
  interface Cancellation {
    isCancelled(): boolean;
    onCancel(handler: (cancelled: JoinCancelled) => void): CancellationRegistration;
  }
}

const cancellationPrototype = JoinCancellation.prototype as JoinCancellation & {
  isCancelled?: () => boolean;
  onCancel?: (handler: (cancelled: JoinCancelled) => void) => CancellationRegistration;
};

if (cancellationPrototype.isCancelled === undefined) {
  Object.defineProperty(cancellationPrototype, "isCancelled", {
    value(this: JoinCancellation): boolean {
      return signalOfCancellation(this).aborted;
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

if (cancellationPrototype.onCancel === undefined) {
  Object.defineProperty(cancellationPrototype, "onCancel", {
    value(this: JoinCancellation, handler: (cancelled: JoinCancelled) => void): CancellationRegistration {
      return onCancellation(this, handler);
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

function callableSignal(signal: AbortSignal): AbortSignal & (() => AbortSignal) {
  const callable = (() => signal) as AbortSignal & (() => AbortSignal);
  // Preserve the useful native nominal check while forwarding every operation
  // to the actual signal as its receiver (AbortSignal accessors are branded).
  Object.setPrototypeOf(callable, AbortSignal.prototype);
  return new Proxy(callable, {
    get(_target, property) {
      const value = Reflect.get(signal, property, signal) as unknown;
      return typeof value === "function" ? value.bind(signal) : value;
    },
    set() { return false; },
    defineProperty() { return false; },
    deleteProperty() { return false; },
  });
}

/** Live, manually cancellable capability with optional AbortSignal linkage. */
export class CancellationSource extends JoinCancellation {
  readonly #bridge: AbortSignal & (() => AbortSignal);
  #unlinkSignal?: () => void;

  constructor(linkedSignal?: AbortSignal) {
    super();
    const baseSignal = super.signal;
    this.#bridge = callableSignal(baseSignal);
    if (linkedSignal !== undefined) {
      if (!(linkedSignal instanceof AbortSignal)) {
        throw new TypeError("CancellationSource link must be an AbortSignal");
      }
      if (linkedSignal.aborted) {
        super.cancel(linkedSignal.reason);
      } else {
        const forward = () => this.cancel(linkedSignal.reason);
        linkedSignal.addEventListener("abort", forward, { once: true });
        this.#unlinkSignal = () => linkedSignal.removeEventListener("abort", forward);
      }
    }
  }

  /** Callable for the new API and AbortSignal-shaped for join.ts compatibility. */
  override get signal(): AbortSignal & (() => AbortSignal) {
    return this.#bridge;
  }

  override cancel(reason: unknown = "cancelled"): boolean {
    const changed = super.cancel(reason);
    if (changed) {
      this.#unlinkSignal?.();
      this.#unlinkSignal = undefined;
    }
    return changed;
  }

  override unlink(): void {
    super.unlink();
    this.#unlinkSignal?.();
    this.#unlinkSignal = undefined;
  }
}

/** Test helper: a fresh token that can never become cancelled through its API. */
export function neverCancelled(): JoinCancellation {
  return new NeverCancellation();
}

class NeverCancellation extends JoinCancellation {
  override cancel(_reason: unknown = "cancelled"): boolean {
    return false;
  }
}

/** Test helper: a fresh token whose first checkpoint already fails. */
export function alreadyCancelled(reason: unknown = "cancelled"): JoinCancellation {
  const cancellation = new CancellationSource();
  cancellation.cancel(reason);
  return cancellation;
}

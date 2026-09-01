import {
  Context,
  RuntimeValues,
  __vsInspectResult,
  registerErrorCodec,
  type JsonValue,
  type Result,
} from "../runtime/index.ts";
import { Governor, governorFrom, type ConcurrencyBound } from "./governor.ts";
import { type Arm, type Dispatch, armWork, dispatchVia, Scheduler, schedulerFor } from "./scheduler.ts";

function reasonLabel(reason: unknown): string {
  if (typeof reason === "string" && reason.length > 0) return reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return "cancelled";
}

export class Cancelled extends Error {
  constructor(readonly reason: unknown = "cancelled") {
    super(reasonLabel(reason), reason instanceof Error ? { cause: reason } : undefined);
    this.name = "Cancelled";
  }
}

registerErrorCodec(Cancelled, "smithers:Cancelled@1", {
  encode: (error): JsonValue => ({ reason: reasonLabel(error.reason) }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 1 || typeof payload.reason !== "string"
    ) {
      throw new TypeError("invalid Cancelled payload");
    }
    return new Cancelled(payload.reason);
  },
});

/** Cancellation is an ordinary capability supplied by a Layer. */
export class Cancellation extends Context {
  readonly #controller = new AbortController();
  #unlinkParent?: () => void;

  get signal(): AbortSignal { return this.#controller.signal; }
  get aborted(): boolean { return this.signal.aborted; }
  get reason(): unknown { return this.signal.reason; }

  cancel(reason: unknown = "cancelled"): boolean {
    if (this.signal.aborted) return false;
    this.#controller.abort(reason);
    this.#unlinkParent?.();
    this.#unlinkParent = undefined;
    return true;
  }

  checkpoint(): Result<void, Cancelled> {
    return this.signal.aborted
      ? RuntimeValues.failure(new Cancelled(this.signal.reason))
      : RuntimeValues.success(undefined);
  }

  /** TypeScript compatibility fallback; Smithers source uses checkpoint(). */
  check(): void {
    const state = __vsInspectResult(this.checkpoint());
    if (!state.ok) throw state.error;
  }

  whenCancelled(): Promise<Cancelled> {
    if (this.signal.aborted) return Promise.resolve(new Cancelled(this.signal.reason));
    return new Promise((resolve) => {
      this.signal.addEventListener("abort", () => resolve(new Cancelled(this.signal.reason)), { once: true });
    });
  }

  static child(parent: Cancellation): Cancellation {
    if (!(parent instanceof Cancellation)) throw new TypeError("Cancellation.child requires a Cancellation");
    const child = new Cancellation();
    if (parent.signal.aborted) {
      child.cancel(parent.signal.reason);
      return child;
    }
    const forward = () => child.cancel(parent.signal.reason);
    parent.signal.addEventListener("abort", forward, { once: true });
    child.#unlinkParent = () => parent.signal.removeEventListener("abort", forward);
    return child;
  }

  /** Release only the parent link; this does not cancel either token. */
  unlink(): void {
    this.#unlinkParent?.();
    this.#unlinkParent = undefined;
  }
}

/**
 * Tuple-preserving ordinary Promise join. Result aggregation remains Result.all.
 *
 * ## Why not `Promise.all`
 *
 * `Promise.all` is order-INDEPENDENT on its success path — the tuple it builds
 * is in submission order whatever the arrival order was — but its FAILURE path
 * is not: it rejects with whichever input rejected first *in arrival order*. So
 * a body whose inputs both fail reports a different error depending on host
 * timing, and that is arrival order leaking into an observable value.
 *
 * Settling every input and reporting the LOWEST-INDEX rejection makes the
 * answer a function of program order alone. This needs no `Scheduler`: the
 * choice is decided by position in the argument list, not by when anything
 * arrived, so there is no interleaving left to journal.
 *
 * The cost is stated rather than hidden: rejection now surfaces after every
 * input has settled rather than at the first failure. `Promise.all` would have
 * left the later rejections unobserved anyway, so nothing that was awaited
 * before is dropped — only the moment of reporting moves.
 */
export async function awaitAll<const Values extends readonly unknown[]>(
  ...values: Values
): Promise<{ -readonly [Index in keyof Values]: Awaited<Values[Index]> }> {
  const settled = await Promise.allSettled(values);
  for (const outcome of settled) {
    if (outcome.status === "rejected") throw outcome.reason;
  }
  return settled.map((outcome) => (outcome as PromiseFulfilledResult<unknown>).value) as {
    -readonly [Index in keyof Values]: Awaited<Values[Index]>;
  };
}

export type Awaitable<T> = T | PromiseLike<T>;
export type InputSource<T> = Iterable<T> | AsyncIterable<T>;

export interface MapUnorderedOptions {
  readonly concurrency: ConcurrencyBound;
  /** TypeScript adapter escape hatch; authored Smithers normally uses Cancellation.context(). */
  readonly cancellation?: Cancellation;
  /**
   * The same escape hatch for the scheduler, and it is load-bearing rather
   * than decorative: `Stream.interrupt` builds its `mapUnordered` INSIDE an
   * async generator body, which runs at drive time when the caller's Layer has
   * long been left. A capability read there would find nothing. So the
   * enclosing method resolves the scheduler while it still can and hands it
   * down, exactly as it already does for the cancellation.
   */
  readonly scheduler?: Scheduler;
}

type Mapper<Input, Output> = (input: Input, cancellation: Cancellation) => Awaitable<Output>;
type Completion<Output> =
  | { readonly kind: "value"; readonly token: number; readonly value: Output }
  | { readonly kind: "error"; readonly token: number; readonly error: unknown };
type SourceCompletion<Input> =
  | { readonly kind: "source"; readonly next: IteratorResult<Input> }
  | { readonly kind: "source-error"; readonly error: unknown };

export function mapUnordered<Input, Output>(
  inputs: InputSource<Input>,
  mapper: Mapper<Input, Output>,
  concurrency: ConcurrencyBound,
): AsyncGenerator<Output>;
export function mapUnordered<Input, Output>(
  inputs: InputSource<Input>,
  mapper: Mapper<Input, Output>,
  options: MapUnorderedOptions,
): AsyncGenerator<Output>;
/** Compatibility overload for the original POC call shape. */
export function mapUnordered<Input, Output>(
  inputs: InputSource<Input>,
  concurrency: ConcurrencyBound,
  mapper: Mapper<Input, Output>,
  cancellation?: Cancellation,
): AsyncGenerator<Output>;
export function mapUnordered<Input, Output>(
  inputs: InputSource<Input>,
  mapperOrConcurrency: Mapper<Input, Output> | ConcurrencyBound,
  optionsOrMapper: MapUnorderedOptions | ConcurrencyBound | Mapper<Input, Output>,
  legacyCancellation?: Cancellation,
): AsyncGenerator<Output> {
  const modern = typeof mapperOrConcurrency === "function";
  const mapper = (modern ? mapperOrConcurrency : optionsOrMapper) as Mapper<Input, Output>;
  if (typeof mapper !== "function") throw new TypeError("mapUnordered requires a mapper function");
  const directBound = typeof optionsOrMapper === "number" || optionsOrMapper instanceof Governor;
  const options = modern && !directBound ? optionsOrMapper as MapUnorderedOptions : undefined;
  if (modern && !directBound && (typeof optionsOrMapper !== "object" || optionsOrMapper === null)) {
    throw new TypeError("mapUnordered requires a concurrency bound or options");
  }
  const bound = modern ? directBound ? optionsOrMapper as ConcurrencyBound : options!.concurrency : mapperOrConcurrency;
  const governor = governorFrom(bound as ConcurrencyBound, "mapUnordered concurrency");
  // FIXED (was: KNOWN DEFECT). Every shape now consults the dependency model.
  // The shorthand shapes used to substitute `new Cancellation()`, a fresh root
  // nobody holds a reference to, so `mapUnordered(inputs, mapper, 2)` silently
  // ignored a cancellation that the otherwise identical
  // `mapUnordered(inputs, mapper, { concurrency: 2 })` honored, and kept
  // running work the caller had already cancelled.
  //
  // The cost is the one the old comment measured: a shorthand call outside a
  // Layer now panics instead of running uncancellable. That is the correct
  // direction — an unprovided capability failing closed — and it is the same
  // rule the rest of the tree already follows.
  const parent = modern
    ? options
      ? options.cancellation ?? Cancellation.context()
      : Cancellation.context()
    : legacyCancellation ?? Cancellation.context();
  if (!(parent instanceof Cancellation)) throw new TypeError("mapUnordered cancellation must be a Cancellation");
  // Resolved at CALL time alongside the cancellation, not inside the generator
  // body: the body runs after its enclosing Layer has been left.
  return mapUnorderedImpl(inputs, governor, mapper, parent, dispatchVia(schedulerFor(options?.scheduler, "mapUnordered")));
}

async function* mapUnorderedImpl<Input, Output>(
  inputs: InputSource<Input>,
  governor: Governor,
  mapper: Mapper<Input, Output>,
  parent: Cancellation,
  dispatch: Dispatch,
): AsyncGenerator<Output> {
  const child = Cancellation.child(parent);
  let iterator: AsyncIterator<Input>;
  try {
    const inputType = typeof inputs;
    if ((inputType !== "object" && inputType !== "function" && inputType !== "string") || inputs === null) {
      throw new TypeError("mapUnordered inputs must be iterable");
    }
    const asyncFactory = (inputs as AsyncIterable<Input>)[Symbol.asyncIterator];
    const syncFactory = (inputs as Iterable<Input>)[Symbol.iterator];
    if (typeof asyncFactory === "function") iterator = asyncFactory.call(inputs);
    else if (typeof syncFactory === "function") iterator = asyncIteratorFromSync(syncFactory.call(inputs));
    else throw new TypeError("mapUnordered inputs must be iterable");
    if (typeof iterator?.next !== "function") throw new TypeError("mapUnordered iterator must define next()");
  } catch (error) {
    child.unlink();
    throw error;
  }
  const active = new Map<number, Arm<Completion<Output>>>();
  let token = 0;
  let sourceDone = false;
  let completedNormally = false;
  let primaryFailure = false;
  let firstFailure: { readonly error: unknown } | undefined;
  let pendingNext: Arm<SourceCompletion<Input>> | undefined;
  const cancelled = child.whenCancelled();
  const rememberFailure = (error: unknown): unknown => {
    firstFailure ??= { error };
    return error;
  };

  const scheduleNext = (): void => {
    if (sourceDone || pendingNext || active.size >= governor.limit) return;
    child.check();
    const pull = Promise.resolve()
      .then(() => iterator.next())
      .then(
        (next): SourceCompletion<Input> => ({ kind: "source", next }),
        (error): SourceCompletion<Input> => ({ kind: "source-error", error: rememberFailure(error) }),
      );
    // AsyncIterator has no universal abort hook. Racing the logical pull lets
    // cleanup join promptly after cancellation while the handler installed on
    // the raw pull continues to contain any late source rejection.
    //
    // This inner race is load-bearing and is NOT the same decision as the outer
    // loop's: cancellation already competes out there, but if `pendingNext`
    // were the bare source pull then a source that never settles after
    // cancellation would hang the `allSettled` join in `finally`. So it is a
    // second arrival-order decision, and it gets journalled like one.
    pendingNext = dispatch.start("mapUnordered.pull", () =>
      dispatch.firstReady<SourceCompletion<Input>>("mapUnordered.pull", [
        dispatch.start("mapUnordered.pull.source", () => pull),
        dispatch.start(
          "mapUnordered.pull.stop",
          async (): Promise<SourceCompletion<Input>> => ({ kind: "source-error", error: await cancelled }),
        ),
      ]));
  };

  const startMapper = (input: Input): void => {
    const current = token++;
    // Ticketed at submission: for a body starting mappers in program order the
    // submission index IS program order, which is what the spec asks for rather
    // than an approximation of it.
    const task = dispatch.start("mapUnordered.mapper", () =>
      governor.run(async (): Promise<Completion<Output>> => {
        try {
          child.check();
          return { kind: "value", token: current, value: await mapper(input, child) };
        } catch (error) {
          return { kind: "error", token: current, error: rememberFailure(error) };
        }
      }));
    active.set(current, task);
  };

  try {
    // Ticketed once and re-offered on every iteration, so the cancellation arm
    // keeps one stable submission key instead of minting a new one per race.
    const cancellationCompletion = dispatch.start(
      "mapUnordered.cancellation",
      async (): Promise<Completion<Output>> => ({
        kind: "error",
        token: -1,
        error: rememberFailure(await cancelled),
      }),
    );
    scheduleNext();
    while (active.size > 0 || pendingNext) {
      // Put cancellation and mapper completions before the source pull so an
      // already-settled stop/failure cannot accidentally launch more work.
      const contenders: Array<Arm<Completion<Output> | SourceCompletion<Input>>> = [
        cancellationCompletion,
        ...active.values(),
      ];
      if (pendingNext) contenders.push(pendingNext);
      const completion = await dispatch.firstReady("mapUnordered", contenders);

      if (completion.kind === "source-error") {
        pendingNext = undefined;
        child.cancel(completion.error);
        throw firstFailure?.error ?? completion.error;
      }
      if (completion.kind === "source") {
        pendingNext = undefined;
        if (completion.next.done) sourceDone = true;
        else startMapper(completion.next.value);
        scheduleNext();
        continue;
      }

      if (completion.token >= 0) active.delete(completion.token);
      if (completion.kind === "error") {
        child.cancel(completion.error);
        throw firstFailure?.error ?? completion.error;
      }
      scheduleNext();
      yield completion.value;
    }
    completedNormally = true;
  } catch (error) {
    primaryFailure = true;
    child.cancel(error);
    throw error;
  } finally {
    if (!completedNormally) child.cancel("mapUnordered iteration closed");
    let cleanupFailed = false;
    let cleanupFailure: unknown;
    let close: Promise<void> | undefined;
    if (!sourceDone && iterator.return) {
      close = Promise.resolve()
        .then(() => iterator.return!())
        .then(() => undefined);
      void close.catch(() => undefined);
    }
    try {
      // A join, not a race: `allSettled` cannot observe arrival order, so it
      // needs no scheduler and charges no requirement.
      const work: Array<Arm<unknown>> = pendingNext ? [...active.values(), pendingNext] : [...active.values()];
      await Promise.allSettled(work.map(armWork));
      if (close) await close;
    } catch (error) {
      cleanupFailed = true;
      cleanupFailure = error;
    } finally {
      child.unlink();
    }
    if (!primaryFailure && cleanupFailed) throw cleanupFailure;
  }
}

function asyncIteratorFromSync<T>(iterator: Iterator<T>): AsyncIterator<T> {
  return {
    next: async () => iterator.next(),
    return: iterator.return ? async (value?: unknown) => iterator.return!(value) : undefined,
    throw: iterator.throw ? async (error?: unknown) => iterator.throw!(error) : undefined,
  };
}

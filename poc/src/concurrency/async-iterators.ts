import { Governor, governorFrom, type ConcurrencyBound } from "./governor.ts";
import {
  Cancellation,
  mapUnordered,
  type Awaitable,
  type InputSource,
  type MapUnorderedOptions,
} from "./join.ts";

type Predicate<Input> = (input: Input, cancellation: Cancellation) => Awaitable<unknown>;
export type FilterUnorderedOptions = MapUnorderedOptions;

export function filterUnordered<Input>(
  inputs: InputSource<Input>,
  predicate: Predicate<Input>,
  concurrency: ConcurrencyBound,
): AsyncGenerator<Input>;
export function filterUnordered<Input>(
  inputs: InputSource<Input>,
  predicate: Predicate<Input>,
  options: FilterUnorderedOptions,
): AsyncGenerator<Input>;
export function filterUnordered<Input>(
  inputs: InputSource<Input>,
  concurrency: ConcurrencyBound,
  predicate: Predicate<Input>,
  cancellation?: Cancellation,
): AsyncGenerator<Input>;
export function filterUnordered<Input>(
  inputs: InputSource<Input>,
  predicateOrConcurrency: Predicate<Input> | ConcurrencyBound,
  optionsOrPredicate: FilterUnorderedOptions | ConcurrencyBound | Predicate<Input>,
  legacyCancellation?: Cancellation,
): AsyncGenerator<Input> {
  const modern = typeof predicateOrConcurrency === "function";
  const predicate = (modern ? predicateOrConcurrency : optionsOrPredicate) as Predicate<Input>;
  if (typeof predicate !== "function") throw new TypeError("filterUnordered requires a predicate function");
  const mappedPredicate = async (input: Input, cancellation: Cancellation) => ({
    input,
    keep: Boolean(await predicate(input, cancellation)),
  });
  let mapped: AsyncGenerator<{ readonly input: Input; readonly keep: boolean }>;
  if (!modern) {
    mapped = mapUnordered(inputs, predicateOrConcurrency as ConcurrencyBound, mappedPredicate, legacyCancellation);
  } else if (typeof optionsOrPredicate === "number" || optionsOrPredicate instanceof Governor) {
    mapped = mapUnordered(inputs, mappedPredicate, optionsOrPredicate);
  } else {
    mapped = mapUnordered(inputs, mappedPredicate, optionsOrPredicate as FilterUnorderedOptions);
  }
  return filterUnorderedImpl(mapped);
}

async function* filterUnorderedImpl<Input>(
  mapped: AsyncGenerator<{ readonly input: Input; readonly keep: boolean }>,
): AsyncGenerator<Input> {
  for await (const result of mapped) {
    if (result.keep) yield result.input;
  }
}

export interface BufferedUnorderedOptions {
  readonly concurrency: ConcurrencyBound;
  /** TypeScript adapter escape hatch; authored Smithers normally uses Cancellation.context(). */
  readonly cancellation?: Cancellation;
}

type PullCompletion<Input> =
  | { readonly kind: "source"; readonly token: number; readonly next: IteratorResult<Input> }
  | { readonly kind: "source-error"; readonly token: number; readonly error: unknown };

export function bufferedUnordered<Input>(
  inputs: InputSource<Input>,
  concurrency: ConcurrencyBound,
  cancellation?: Cancellation,
): AsyncGenerator<Input>;
export function bufferedUnordered<Input>(
  inputs: InputSource<Input>,
  options: BufferedUnorderedOptions,
): AsyncGenerator<Input>;
export function bufferedUnordered<Input>(
  inputs: InputSource<Input>,
  boundOrOptions: ConcurrencyBound | BufferedUnorderedOptions,
  legacyCancellation?: Cancellation,
): AsyncGenerator<Input> {
  const directBound = typeof boundOrOptions === "number" || boundOrOptions instanceof Governor;
  if (!directBound && (typeof boundOrOptions !== "object" || boundOrOptions === null)) {
    throw new TypeError("bufferedUnordered requires a concurrency bound or options");
  }
  const options = directBound ? undefined : boundOrOptions as BufferedUnorderedOptions;
  const governor = governorFrom(
    directBound ? boundOrOptions as ConcurrencyBound : options!.concurrency,
    "bufferedUnordered concurrency",
  );
  // KNOWN DEFECT (reproduced, not fixed here). Same shape as the one described
  // at the matching site in `join.ts`: `bufferedUnordered(source, 2)` ignores a
  // cancellation that `bufferedUnordered(source, { concurrency: 2 })` honors.
  const parent = options
    ? options.cancellation ?? Cancellation.context()
    : legacyCancellation ?? new Cancellation();
  if (!(parent instanceof Cancellation)) {
    throw new TypeError("bufferedUnordered cancellation must be a Cancellation");
  }
  return bufferedUnorderedImpl(inputs, governor, parent);
}

async function* bufferedUnorderedImpl<Input>(
  inputs: InputSource<Input>,
  governor: Governor,
  parent: Cancellation,
): AsyncGenerator<Input> {
  const child = Cancellation.child(parent);
  let iterator: AsyncIterator<Input>;
  try {
    iterator = toAsyncIterator(inputs, "bufferedUnordered");
  } catch (error) {
    child.unlink();
    throw error;
  }

  const active = new Map<number, Promise<PullCompletion<Input>>>();
  const cancelled = child.whenCancelled();
  let token = 0;
  let sourceDone = false;
  let completedNormally = false;
  let primaryFailure = false;
  let firstFailure: { readonly error: unknown } | undefined;
  const rememberFailure = (error: unknown): unknown => {
    firstFailure ??= { error };
    return error;
  };

  const fill = (): void => {
    while (!sourceDone && active.size < governor.limit) {
      const current = token++;
      const pull = governor.run(async (): Promise<PullCompletion<Input>> => {
        try {
          child.check();
          return { kind: "source", token: current, next: await iterator.next() };
        } catch (error) {
          return { kind: "source-error", token: current, error: rememberFailure(error) };
        }
      });
      active.set(current, pull);
    }
  };

  try {
    const cancellationCompletion = cancelled.then(
      (error): PullCompletion<Input> => ({ kind: "source-error", token: -1, error: rememberFailure(error) }),
    );
    fill();
    while (active.size > 0) {
      const completion = await Promise.race([cancellationCompletion, ...active.values()]);
      if (completion.token >= 0) active.delete(completion.token);
      if (completion.kind === "source-error") throw firstFailure?.error ?? completion.error;
      if (completion.next.done) {
        sourceDone = true;
        continue;
      }
      fill();
      yield completion.next.value;
    }
    completedNormally = true;
  } catch (error) {
    primaryFailure = true;
    child.cancel(error);
    throw error;
  } finally {
    if (!completedNormally) child.cancel("bufferedUnordered iteration closed");
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
      await Promise.allSettled(active.values());
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

function toAsyncIterator<Input>(inputs: InputSource<Input>, label: string): AsyncIterator<Input> {
  const inputType = typeof inputs;
  if ((inputType !== "object" && inputType !== "function" && inputType !== "string") || inputs === null) {
    throw new TypeError(`${label} inputs must be iterable`);
  }
  const asyncFactory = (inputs as AsyncIterable<Input>)[Symbol.asyncIterator];
  const syncFactory = (inputs as Iterable<Input>)[Symbol.iterator];
  let iterator: AsyncIterator<Input>;
  if (typeof asyncFactory === "function") iterator = asyncFactory.call(inputs);
  else if (typeof syncFactory === "function") iterator = asyncIteratorFromSync(syncFactory.call(inputs));
  else throw new TypeError(`${label} inputs must be iterable`);
  if (typeof iterator?.next !== "function") throw new TypeError(`${label} iterator must define next()`);
  return iterator;
}

function asyncIteratorFromSync<Input>(iterator: Iterator<Input>): AsyncIterator<Input> {
  return {
    next: async () => iterator.next(),
    return: iterator.return ? async (value?: unknown) => iterator.return!(value) : undefined,
    throw: iterator.throw ? async (error?: unknown) => iterator.throw!(error) : undefined,
  };
}

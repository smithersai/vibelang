import { isLocalError, type ErrorConstructor } from "./errors.ts";
import { Panic, isPanic, panic } from "./panic.ts";
import { decodeResult, encodeResult, type ValueCodec } from "./wire.ts";

type ResultState<A, E extends Error> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

type PanicFailure<E extends Error> = Panic extends E ? Panic : Extract<E, Panic>;
type RecoverableFailure<E extends Error> = Exclude<E, Panic>;

const states = new WeakMap<object, ResultState<unknown, Error>>();
const localResults = new WeakSet<object>();

function stateOf<A, E extends Error>(result: Result<A, E>): ResultState<A, E> {
  const state = states.get(result as object);
  if (!state || !localResults.has(result as object)) panic("forged Result value");
  return state as ResultState<A, E>;
}

export abstract class ResultValue<A, E extends Error> {
  isOk(): boolean { return stateOf(this).ok; }
  isError(): boolean { return !stateOf(this).ok; }

  match<Ok, Failure>(handlers: { readonly ok: (value: A) => Ok; readonly error: (error: E) => Failure }): Ok | Failure {
    if (typeof handlers?.ok !== "function" || typeof handlers.error !== "function") {
      panic("Result.match requires ok and error handlers");
    }
    const state = stateOf(this);
    return state.ok ? handlers.ok(state.value) : handlers.error(state.error);
  }

  map<B>(mapper: (value: A) => B): Result<B, E> {
    const state = stateOf(this);
    return state.ok ? __vsResultSuccess(mapper(state.value)) : this as unknown as Result<B, E>;
  }

  mapError<F extends Error>(mapper: (error: E) => F): Result<A, F> {
    const state = stateOf(this);
    if (state.ok) return this as unknown as Result<A, F>;
    return __vsResultFailure(mapper(state.error));
  }

  andThen<B, F extends Error>(mapper: (value: A) => Result<B, F>): Result<B, E | F> {
    const state = stateOf(this);
    if (!state.ok) return this as unknown as Result<B, E>;
    const next = mapper(state.value);
    if (!isResult(next)) panic("Result.andThen callback did not return a Result");
    return next;
  }

  async andThenAsync<B, F extends Error>(
    mapper: (value: A) => Result<B, F> | PromiseLike<Result<B, F>>,
  ): Promise<Result<B, E | F>> {
    const state = stateOf(this);
    if (!state.ok) return this as unknown as Result<B, E>;
    const next = await mapper(state.value);
    if (!isResult(next)) panic("Result.andThenAsync callback did not return a Result");
    return next;
  }

  /**
   * Collapses one level of nesting. This is `andThen(identity)` with the
   * callback's "did the callback really return a Result?" check kept: a forged
   * or non-Result payload panics here exactly as it does in `andThen`, so
   * flattening cannot be used to smuggle an unbranded value into the channel.
   */
  flatten<B, F extends Error>(this: ResultValue<Result<B, F>, E>): Result<B, E | F> {
    const state = stateOf(this);
    if (!state.ok) return this as unknown as Result<B, E>;
    if (!isResult(state.value)) panic("Result.flatten requires a nested Result");
    return state.value;
  }

  recover<B, F extends Error = never>(
    mapper: (error: RecoverableFailure<E>) => B | Result<B, F>,
  ): Result<A | B, F | PanicFailure<E>> {
    const state = stateOf(this);
    if (state.ok || isPanic(state.error)) {
      return this as unknown as Result<A | B, F | PanicFailure<E>>;
    }
    const recovered = mapper(state.error as RecoverableFailure<E>);
    return isResult(recovered)
      ? recovered as Result<B, F | PanicFailure<E>>
      : __vsResultSuccess(recovered);
  }

  tryRecover<B, F extends Error>(
    mapper: (error: RecoverableFailure<E>) => Result<B, F>,
  ): Result<A | B, F | PanicFailure<E>> {
    const state = stateOf(this);
    if (state.ok || isPanic(state.error)) {
      return this as unknown as Result<A | B, F | PanicFailure<E>>;
    }
    const recovered = mapper(state.error as RecoverableFailure<E>);
    if (!isResult(recovered)) panic("Result.tryRecover callback did not return a Result");
    return recovered;
  }

  async tryRecoverAsync<B, F extends Error>(
    mapper: (error: RecoverableFailure<E>) => Result<B, F> | PromiseLike<Result<B, F>>,
  ): Promise<Result<A | B, F | PanicFailure<E>>> {
    const state = stateOf(this);
    if (state.ok || isPanic(state.error)) {
      return this as unknown as Result<A | B, F | PanicFailure<E>>;
    }
    const recovered = await mapper(state.error as RecoverableFailure<E>);
    if (!isResult(recovered)) panic("Result.tryRecoverAsync callback did not return a Result");
    return recovered;
  }

  tap(observer: (value: A) => unknown): Result<A, E> {
    const state = stateOf(this);
    if (state.ok) observer(state.value);
    return this;
  }

  async tapAsync(observer: (value: A) => unknown): Promise<Result<A, E>> {
    const state = stateOf(this);
    if (state.ok) await observer(state.value);
    return this;
  }

  tapError(observer: (error: E) => unknown): Result<A, E> {
    const state = stateOf(this);
    if (!state.ok) observer(state.error);
    return this;
  }

  async tapErrorAsync(observer: (error: E) => unknown): Promise<Result<A, E>> {
    const state = stateOf(this);
    if (!state.ok) await observer(state.error);
    return this;
  }

  /**
   * Observes whichever variant is active without changing it. The handler
   * object is validated the way `match`'s is, so a missing branch is a panic
   * rather than a silently skipped observation.
   */
  tapBoth(handlers: {
    readonly ok: (value: A) => unknown;
    readonly error: (error: E) => unknown;
  }): Result<A, E> {
    if (typeof handlers?.ok !== "function" || typeof handlers.error !== "function") {
      panic("Result.tapBoth requires ok and error handlers");
    }
    const state = stateOf(this);
    if (state.ok) handlers.ok(state.value);
    else handlers.error(state.error);
    return this;
  }

  async tapBothAsync(handlers: {
    readonly ok: (value: A) => unknown;
    readonly error: (error: E) => unknown;
  }): Promise<Result<A, E>> {
    if (typeof handlers?.ok !== "function" || typeof handlers.error !== "function") {
      panic("Result.tapBothAsync requires ok and error handlers");
    }
    const state = stateOf(this);
    if (state.ok) await handlers.ok(state.value);
    else await handlers.error(state.error);
    return this;
  }

  /** Missed-lowering fallback. The compiler normally emits an early Result return. */
  unwrap(): A {
    const state = stateOf(this);
    if (state.ok) return state.value;
    throw state.error;
  }

  unwrapOr<B>(fallback: B | ((error: E) => B)): A | B {
    const state = stateOf(this);
    if (state.ok) return state.value;
    return typeof fallback === "function" ? (fallback as (error: E) => B)(state.error) : fallback;
  }

  expect(message: string): A {
    const state = stateOf(this);
    if (state.ok) return state.value;
    panic(new Error(message, { cause: state.error }));
  }

  get [Symbol.toStringTag](): string { return "Result"; }
}

export type Result<A, E extends Error> = ResultValue<A, E>;

class LocalResult<A, E extends Error> extends ResultValue<A, E> {
  constructor(state: ResultState<A, E>) {
    super();
    const frozen = Object.freeze(state);
    states.set(this, frozen as ResultState<unknown, Error>);
    localResults.add(this);
    Object.freeze(this);
  }
}

export function isResult(value: unknown): value is Result<unknown, Error> {
  return typeof value === "object" && value !== null && localResults.has(value);
}

/** Validate a non-suspending fallible body's final completion, after cleanup. */
export function __vsCompleteResult<R extends Result<unknown, Error>>(value: R): R {
  if (!isResult(value)) panic("a function with a non-empty failure row completed without a Result");
  return value;
}

/** Compiler lowering hook; intentionally absent from the author-facing Result namespace. */
export function __vsResultSuccess<A>(value: A): Result<A, never> {
  return new LocalResult({ ok: true, value });
}

/** Compiler lowering hook; intentionally absent from the author-facing Result namespace. */
export function __vsResultFailure<E extends Error>(error: E): Result<never, E> {
  if (!isLocalError(error)) panic("Result failure must be a locally constructed or decoded Error");
  return new LocalResult({ ok: false, error });
}

/**
 * Lets the distinguished panic channel escape a typed failure channel.
 *
 * `Result.try` / `Result.tryPromise` widen the failure channel with `Panic`
 * because a panic raised inside a foreign call must not be swallowed. A library
 * that declares only its recoverable `E` calls this at the boundary: a `Panic`
 * failure is re-thrown so it keeps unwinding to `catchPanic`, and every other
 * Result is returned unchanged with the panic dropped from the static channel.
 *
 * This is the inverse of `catchPanic`: `catchPanic` turns a thrown panic
 * into a value, `rethrowPanics` turns a panic-valued failure back into a throw.
 * Forged Result values panic here, exactly as they do everywhere else.
 */
export function rethrowPanics<A, E extends Error>(result: Result<A, E | Panic>): Result<A, E> {
  const state = stateOf(result);
  if (!state.ok && isPanic(state.error)) throw state.error;
  return result as Result<A, E>;
}

export type InspectedResult<A, E extends Error> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

/** Compiler-only, brand-checked inspection of a Result. */
export function __vsInspectResult<A, E extends Error>(result: Result<A, E>): InspectedResult<A, E> {
  const state = stateOf(result);
  return state.ok
    ? Object.freeze({ ok: true, value: state.value })
    : Object.freeze({ ok: false, error: state.error });
}

/** An empty failure row needs no continuation, but still checks the runtime invariant. */
export function __vsUnwrapKnownSuccess<A>(result: Result<A, never>): A {
  const state = stateOf(result);
  if (!state.ok) throw new Panic("An empty failure row carried a failure", { cause: state.error });
  return state.value;
}

function foreignPanic(cause: unknown): Panic {
  if (isPanic(cause)) return cause;
  if (isLocalError(cause)) return new Panic(`Foreign exception: ${cause.message}`, { cause });
  return new Panic("Foreign implementation threw a non-Error value", { cause });
}

function mappedFailure<E extends Error>(cause: unknown, mapper?: (cause: unknown) => E): E | Panic {
  if (isPanic(cause)) return cause;
  if (!mapper) return foreignPanic(cause);
  const mapped = mapper(cause);
  if (!isLocalError(mapped)) panic("foreign exception mapper did not return a local Error");
  return mapped;
}

type ResultSuccess<R> = R extends Result<infer A, Error> ? A : never;
type ResultFailure<R> = R extends Result<unknown, infer E> ? E : never;

function all<const Values extends readonly Result<unknown, Error>[]>(
  values: Values,
): Result<{ -readonly [Index in keyof Values]: ResultSuccess<Values[Index]> }, ResultFailure<Values[number]>>;
function all<A, E extends Error>(values: Iterable<Result<A, E>>): Result<A[], E>;
function all(values: Iterable<Result<unknown, Error>>): Result<unknown[], Error> {
  const output: unknown[] = [];
  for (const value of values) {
    if (!isResult(value)) panic("Result.all received a forged Result value");
    const state = stateOf(value);
    if (!state.ok) return __vsResultFailure(state.error);
    output.push(state.value);
  }
  return __vsResultSuccess(output);
}

/** Join every input before exposing an outcome, and choose failures by input order. */
async function settledResults<A, E extends Error>(
  values: Iterable<Result<A, E> | PromiseLike<Result<A, E>>>,
): Promise<Result<A, E>[]> {
  // Promise.allSettled(iterable) rejects immediately if iteration throws. Own
  // the submitted prefix separately so even that failure joins started work.
  const submitted: Promise<Result<A, E>>[] = [];
  let iterationFailure: { cause: unknown } | undefined;
  try {
    for (const value of values) submitted.push(Promise.resolve(value));
  } catch (cause) {
    iterationFailure = { cause };
  }
  const settled = await Promise.allSettled(submitted);
  if (iterationFailure) throw foreignPanic(iterationFailure.cause);
  const output: Result<A, E>[] = [];
  for (const entry of settled) {
    if (entry.status === "rejected") throw foreignPanic(entry.reason);
    if (!isResult(entry.value)) panic("Result collection received a forged Result value");
    output.push(entry.value);
  }
  return output;
}

function allAsync<const Values extends readonly (Result<unknown, Error> | PromiseLike<Result<unknown, Error>>)[]>(
  values: Values,
): Promise<Result<{ -readonly [Index in keyof Values]: ResultSuccess<Awaited<Values[Index]>> }, ResultFailure<Awaited<Values[number]>>>>;
function allAsync<A, E extends Error>(values: Iterable<Result<A, E> | PromiseLike<Result<A, E>>>): Promise<Result<A[], E>>;
async function allAsync(values: Iterable<Result<unknown, Error> | PromiseLike<Result<unknown, Error>>>): Promise<Result<unknown[], Error>> {
  return all(await settledResults(values));
}

function partition<A, E extends Error>(
  values: Iterable<Result<A, E>>,
): [successes: A[], errors: RecoverableFailure<E>[]] {
  const successes: A[] = [];
  const errors: RecoverableFailure<E>[] = [];
  for (const value of values) {
    const state = stateOf(value);
    if (state.ok) successes.push(state.value);
    else {
      // Partition is ordinary recovery: a defect must not become a domain error array.
      if (isPanic(state.error)) throw state.error;
      errors.push(state.error as RecoverableFailure<E>);
    }
  }
  return [successes, errors];
}

async function partitionAsync<A, E extends Error>(
  values: Iterable<Result<A, E> | PromiseLike<Result<A, E>>>,
): Promise<[successes: A[], errors: RecoverableFailure<E>[]]> {
  return partition(await settledResults(values));
}

export interface ResultCodec<A, E extends Error> {
  readonly encode: (result: Result<A, E>) => string;
  readonly decode: (wire: string) => Result<A, E>;
}

/** Reuse the canonical Result wire format and pin the decoder's nominal error row. */
function codec<A>(value: ValueCodec<A>): ResultCodec<A, Error>;
function codec<A, E extends Error>(value: ValueCodec<A>, allowedErrors: readonly ErrorConstructor<E>[]): ResultCodec<A, E>;
function codec<A, E extends Error>(value: ValueCodec<A>, allowedErrors?: readonly ErrorConstructor<E>[]): ResultCodec<A, E | Error> {
  const payload = Object.freeze({ encode: value.encode, decode: value.decode });
  const errors = allowedErrors === undefined ? undefined : Object.freeze([...allowedErrors]);
  return Object.freeze({
    encode: (result: Result<A, E | Error>) => encodeResult(result, payload),
    decode: (wire: string) => errors === undefined ? decodeResult(wire, payload) : decodeResult(wire, payload, errors),
  });
}

function tryResult<A>(body: () => A): Result<A, Panic>;
function tryResult<A, E extends Error>(body: () => A, mapper: (cause: unknown) => E): Result<A, E | Panic>;
function tryResult<A, E extends Error>(body: () => A, mapper?: (cause: unknown) => E): Result<A, E | Panic> {
  try {
    return __vsResultSuccess(body());
  } catch (cause) {
    return __vsResultFailure(mappedFailure(cause, mapper));
  }
}

async function tryPromise<A>(body: () => PromiseLike<A>): Promise<Result<A, Panic>>;
async function tryPromise<A, E extends Error>(
  body: () => PromiseLike<A>,
  mapper: (cause: unknown) => E,
): Promise<Result<A, E | Panic>>;
async function tryPromise<A, E extends Error>(
  body: () => PromiseLike<A>,
  mapper?: (cause: unknown) => E,
): Promise<Result<A, E | Panic>> {
  try {
    return __vsResultSuccess(await body());
  } catch (cause) {
    return __vsResultFailure(mappedFailure(cause, mapper));
  }
}

export const Result = Object.freeze({
  all,
  allAsync,
  partition,
  partitionAsync,
  codec,
  try: tryResult,
  tryPromise,
});

/** Explicit names for generated foreign-call boundaries. */
export const foreignBoundary = tryResult;
export const foreignBoundaryPromise = tryPromise;

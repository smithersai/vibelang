import { isLocalError } from "./errors.ts";
import { Panic, isPanic, panic } from "./panic.ts";

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

  tap(observer: (value: A) => unknown): Result<A, E> {
    const state = stateOf(this);
    if (state.ok) observer(state.value);
    return this;
  }

  tapError(observer: (error: E) => unknown): Result<A, E> {
    const state = stateOf(this);
    if (!state.ok) observer(state.error);
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

/** Compiler hook used to lower `.unwrap()` to an explicit early return. */
export function __vsInspectResult<A, E extends Error>(result: Result<A, E>): InspectedResult<A, E> {
  const state = stateOf(result);
  return state.ok
    ? Object.freeze({ ok: true, value: state.value })
    : Object.freeze({ ok: false, error: state.error });
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
  try: tryResult,
  tryPromise,
});

/** Explicit names for generated foreign-call boundaries. */
export const foreignBoundary = tryResult;
export const foreignBoundaryPromise = tryPromise;

/**
 * Self-contained VibeLang runtime for the compiler-pipeline end-to-end proof.
 *
 * The POC runtime under `poc/src/runtime` cannot be fed to the pinned Go fork:
 * its modules import each other with explicit `.ts` specifiers (which needs
 * `allowImportingTsExtensions`, outside the bridge's option allowlist) and it
 * depends on `node:async_hooks`, `node:util/types`, and `Buffer`, none of
 * which exist in the fork's bundled lib set. This file therefore reimplements
 * exactly the lowering hooks that `poc/src/language` emits for the fixtures in
 * `scripts/fork-e2e/`, with the same observable semantics.
 *
 * It is compiled by the pinned fork like any other project TypeScript input,
 * so the emitted `vibelang-runtime.js` sits next to the emitted program and the
 * generated `./vibelang-runtime.js` specifier resolves under plain Node ESM.
 */

declare const nominalErrorBrand: unique symbol;

/** Declaration-only brand that keeps sibling Error classes nominally distinct. */
export interface NominalError<Identity extends string> {
  readonly [nominalErrorBrand]: { readonly [Key in Identity]: void };
}

export type InspectedResult<A, E extends Error> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

const states = new WeakMap<object, InspectedResult<unknown, Error>>();
const localResults = new WeakSet<object>();
const identityByConstructor = new WeakMap<object, string>();
const constructorByIdentity = new Map<string, object>();

function stateOf<A, E extends Error>(result: object): InspectedResult<A, E> {
  const state = states.get(result);
  if (state === undefined || !localResults.has(result)) {
    throw new Error("VibeLang runtime received a forged Result value");
  }
  return state as InspectedResult<A, E>;
}

export abstract class ResultValue<A, E extends Error> {
  isOk(): boolean {
    return stateOf<A, E>(this).ok;
  }

  isError(): boolean {
    return !stateOf<A, E>(this).ok;
  }

  match<Ok, Failure>(handlers: {
    readonly ok: (value: A) => Ok;
    readonly error: (error: E) => Failure;
  }): Ok | Failure {
    if (typeof handlers?.ok !== "function" || typeof handlers.error !== "function") {
      throw new Error("Result.match requires ok and error handlers");
    }
    const state = stateOf<A, E>(this);
    return state.ok ? handlers.ok(state.value) : handlers.error(state.error);
  }

  map<B>(mapper: (value: A) => B): Result<B, E> {
    const state = stateOf<A, E>(this);
    return state.ok
      ? __vsResultSuccess(mapper(state.value))
      : (this as unknown as Result<B, E>);
  }

  mapError<F extends Error>(mapper: (error: E) => F): Result<A, F> {
    const state = stateOf<A, E>(this);
    return state.ok
      ? (this as unknown as Result<A, F>)
      : __vsResultFailure(mapper(state.error));
  }

  /** Missed-lowering fallback. The compiler normally emits an early return. */
  unwrap(): A {
    const state = stateOf<A, E>(this);
    if (state.ok) return state.value;
    throw state.error;
  }

  unwrapOr<B>(fallback: B | ((error: E) => B)): A | B {
    const state = stateOf<A, E>(this);
    if (state.ok) return state.value;
    return typeof fallback === "function"
      ? (fallback as (error: E) => B)(state.error)
      : fallback;
  }

  get [Symbol.toStringTag](): string {
    return "Result";
  }
}

export type Result<A, E extends Error> = ResultValue<A, E>;
/** The native SDK lowering uses this unambiguous type-only runtime seam. */
export type ResultType<A, E extends Error> = ResultValue<A, E>;

export interface AnyRequest {
  readonly kind: "get" | "perform" | "abort";
  readonly input: unknown;
  readonly site: string;
}

interface AbortRequest<E extends Error> extends AnyRequest {
  readonly kind: "abort";
  readonly input: E;
}

/** Expression-position propagation for this fixture's failure-only row. */
export function* __vsPropagate<A, E extends Error>(result: Result<A, E>, site: string): Generator<AbortRequest<E>, A, unknown> {
  const state = __vsInspectResult(result);
  if (state.ok) return state.value;
  yield Object.freeze({ kind: "abort" as const, input: state.error, site });
  throw new Error("an abandoned Result continuation was resumed");
}

type CompletionSuccess<R> = R extends Result<infer A, Error> ? A : never;
type CompletionFailure<R> = R extends Result<unknown, infer E> ? E : never;
type RequestedFailure<Y> = Y extends AbortRequest<infer E> ? E : never;

/** Eager one-shot Result delimiter; return() skips catch and drains finally. */
export function __vsRunResult<Y extends AnyRequest, R extends Result<unknown, Error>>(
  body: () => Generator<Y, R, unknown>,
): Result<CompletionSuccess<R>, CompletionFailure<R> | RequestedFailure<Y>> {
  const computation = body();
  try {
    const step = computation.next();
    if (step.done) {
      if (!isResult(step.value)) throw new Error("a Result body completed without a Result");
      return step.value as unknown as Result<CompletionSuccess<R>, CompletionFailure<R> | RequestedFailure<Y>>;
    }
    if (step.value.kind !== "abort" || !(step.value.input instanceof Error)) {
      throw new Error("the failure-only fixture cannot handle this request");
    }
    return __vsResultFailure(step.value.input) as unknown as Result<CompletionSuccess<R>, CompletionFailure<R> | RequestedFailure<Y>>;
  } finally {
    let closing = computation.return(undefined as never);
    let unhandled = false;
    while (!closing.done) {
      unhandled = true;
      closing = computation.return(undefined as never);
    }
    if (unhandled) throw new Error("an unhandled request was issued during fixture cleanup");
  }
}

class LocalResult<A, E extends Error> extends ResultValue<A, E> {
  constructor(state: InspectedResult<A, E>) {
    super();
    const frozen = Object.freeze(state);
    states.set(this, frozen as InspectedResult<unknown, Error>);
    localResults.add(this);
    Object.freeze(this);
  }
}

export function isResult(value: unknown): value is Result<unknown, Error> {
  return typeof value === "object" && value !== null && localResults.has(value);
}

/** Completion ABI for an explicitly typed body that cannot suspend. */
export function __vsCompleteResult<R extends Result<unknown, Error>>(value: R): R {
  if (!isResult(value)) throw new Error("a function with a non-empty failure row completed without a Result");
  return value;
}

/** Compiler lowering hook for a success value. */
export function __vsResultSuccess<A>(value: A): Result<A, never> {
  return new LocalResult<A, never>({ ok: true, value });
}

/** Compiler lowering hook for a failure value. */
export function __vsResultFailure<E extends Error>(error: E): Result<never, E> {
  if (!(error instanceof Error)) {
    throw new Error("Result failure must be a locally constructed Error");
  }
  return new LocalResult<never, E>({ ok: false, error });
}

/** Compiler hook used to lower `.unwrap()` to an explicit early return. */
export function __vsInspectResult<A, E extends Error>(
  result: Result<A, E>,
): InspectedResult<A, E> {
  const state = stateOf<A, E>(result as unknown as object);
  return state.ok
    ? Object.freeze({ ok: true as const, value: state.value })
    : Object.freeze({ ok: false as const, error: state.error });
}

/** Trusted compiler hook emitted once after each named Error class. */
export function __vsRegisterError<T>(type: T, id: string): T {
  if (typeof type !== "function") {
    throw new TypeError("Error identity requires a class extending Error");
  }
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("Error identity requires a stable id");
  }
  const key = type as unknown as object;
  const priorId = identityByConstructor.get(key);
  if (priorId !== undefined && priorId !== id) {
    throw new TypeError(`Error constructor is already registered as ${priorId}`);
  }
  const priorType = constructorByIdentity.get(id);
  if (priorType !== undefined && priorType !== key) {
    throw new TypeError(`stable Error identity ${id} is already registered`);
  }
  identityByConstructor.set(key, id);
  constructorByIdentity.set(id, key);
  return type;
}

/** Stable transport identity of a registered Error constructor. */
export function errorIdentity(type: unknown): string | undefined {
  return typeof type === "function"
    ? identityByConstructor.get(type as unknown as object)
    : undefined;
}

function tryResult<A>(body: () => A): Result<A, Error> {
  try {
    return __vsResultSuccess(body()) as Result<A, Error>;
  } catch (cause) {
    return __vsResultFailure(
      cause instanceof Error ? cause : new Error("Foreign implementation threw a non-Error value"),
    );
  }
}

async function tryPromise<A>(body: () => PromiseLike<A>): Promise<Result<A, Error>> {
  try {
    return __vsResultSuccess(await body()) as Result<A, Error>;
  } catch (cause) {
    return __vsResultFailure(
      cause instanceof Error ? cause : new Error("Foreign implementation threw a non-Error value"),
    );
  }
}

export const Result = Object.freeze({
  try: tryResult,
  tryPromise,
});

const RESULT_BRAND = Symbol.for("vibelang.result");
const ERROR_IDENTITY = Symbol.for("vibelang.error.identity");

export type ErrorConstructor<E extends Error = Error> =
  abstract new (...args: any[]) => E;

export type ErrorMatchHandlers<E extends Error, R> =
  & Readonly<Record<string, (error: E) => R>>
  & {
    readonly _?: (error: E) => R;
    readonly default?: (error: E) => R;
  };

export interface ResultMatcher<T, E extends Error, A, B = A> {
  readonly ok: (value: T) => A;
  readonly error: (error: E) => B;
}

export type InferResultValue<R> = R extends Result<infer T, Error> ? T : never;
export type InferResultError<R> = R extends Result<unknown, infer E> ? E : never;

export class UnhandledException extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "A foreign operation threw", { cause });
    this.name = "UnhandledException";
    this.cause = cause;
  }
}

export class UnhandledErrorMatch extends Error {
  constructor(readonly error: Error) {
    super(`No error.match handler was provided for '${errorIdentity(error)}'`, {
      cause: error,
    });
    this.name = "UnhandledErrorMatch";
  }
}

/**
 * Runtime representation of a fallible VibeLang return value.
 *
 * VibeLang source normally creates variants with plain `return` and `throw`.
 * The compiler lowers those paths to the internal helpers exported at the end
 * of this module, so the public class intentionally has no `ok` or `err`
 * constructors.
 */
export abstract class Result<T, E extends Error = Error> {
  abstract readonly status: "ok" | "error";
  abstract readonly value: T | undefined;
  abstract readonly error: E | undefined;
  readonly [RESULT_BRAND] = true;

  static isResult(value: unknown): value is Result<unknown, Error> {
    return (
      typeof value === "object" &&
      value !== null &&
      RESULT_BRAND in value
    );
  }

  static isOk<T, E extends Error>(
    result: Result<T, E>,
  ): result is Result<T, E> & { readonly status: "ok"; readonly value: T } {
    return result.status === "ok";
  }

  static isError<T, E extends Error>(
    result: Result<T, E>,
  ): result is Result<T, E> & { readonly status: "error"; readonly error: E } {
    return result.status === "error";
  }

  static try<T>(operation: () => T): Result<T, UnhandledException>;
  static try<T, E extends Error>(
    operation: () => T,
    mapError: (cause: unknown) => E,
  ): Result<T, E>;
  static try<T, E extends Error>(
    operation: () => T,
    mapError?: (cause: unknown) => E,
  ): Result<T, E | UnhandledException> {
    try {
      return success(operation());
    } catch (cause) {
      return failure(mapError ? mapError(cause) : new UnhandledException(cause));
    }
  }

  static tryPromise<T>(
    operation: () => Promise<T>,
  ): Promise<Result<T, UnhandledException>>;
  static tryPromise<T, E extends Error>(
    operation: () => Promise<T>,
    mapError: (cause: unknown) => E,
  ): Promise<Result<T, E>>;
  static async tryPromise<T, E extends Error>(
    operation: () => Promise<T>,
    mapError?: (cause: unknown) => E,
  ): Promise<Result<T, E | UnhandledException>> {
    try {
      return success(await operation());
    } catch (cause) {
      return failure(mapError ? mapError(cause) : new UnhandledException(cause));
    }
  }

  static all<const Values extends readonly Result<unknown, Error>[]>(
    values: Values,
  ): Result<
    { readonly [K in keyof Values]: InferResultValue<Values[K]> },
    InferResultError<Values[number]>
  > {
    const successes: unknown[] = [];
    for (const result of values) {
      if (result.isError()) {
        return failure(result.error) as Result<
          { readonly [K in keyof Values]: InferResultValue<Values[K]> },
          InferResultError<Values[number]>
        >;
      }
      successes.push(result.value);
    }
    return success(successes) as Result<
      { readonly [K in keyof Values]: InferResultValue<Values[K]> },
      InferResultError<Values[number]>
    >;
  }

  isOk(): this is this & { readonly status: "ok"; readonly value: T } {
    return this.status === "ok";
  }

  isError(): this is this & { readonly status: "error"; readonly error: E } {
    return this.status === "error";
  }

  match<A, B = A>(matcher: ResultMatcher<T, E, A, B>): A | B {
    return this.isOk()
      ? matcher.ok(this.value)
      : matcher.error(this.error as E);
  }

  map<U>(transform: (value: T) => U): Result<U, E> {
    return this.isOk()
      ? success(transform(this.value))
      : failure<U, E>(this.error as E);
  }

  mapError<F extends Error>(transform: (error: E) => F): Result<T, F> {
    return this.isError()
      ? failure(transform(this.error))
      : success<T, F>(this.value as T);
  }

  andThen<U, F extends Error>(
    transform: (value: T) => U | Result<U, F>,
  ): Result<U, E | F> {
    if (this.isError()) return failure(this.error);
    return liftResult(transform(this.value as T));
  }

  recover<U, F extends Error>(
    transform: (error: E) => U | Result<U, F>,
  ): Result<T | U, F> {
    if (this.isOk()) return success(this.value);
    return liftResult(transform(this.error as E));
  }

  tap(observe: (value: T) => void): Result<T, E> {
    if (this.isOk()) observe(this.value);
    return this;
  }

  tapError(observe: (error: E) => void): Result<T, E> {
    if (this.isError()) observe(this.error);
    return this;
  }

  /**
   * In compiled VibeLang this is a propagation point. The JavaScript fallback
   * throws the original Error so accidental uncompiled use fails visibly.
   */
  unwrap(): T {
    if (this.isOk()) return this.value;
    throw this.error;
  }

  unwrapOr<U>(fallback: U | ((error: E) => U)): T | U {
    if (this.isOk()) return this.value;
    return typeof fallback === "function"
      ? (fallback as (error: E) => U)(this.error as E)
      : fallback;
  }

  expect(message: string): T {
    if (this.isOk()) return this.value;
    throw new Error(message, { cause: this.error });
  }

  toJSON():
    | { readonly status: "ok"; readonly value: T }
    | { readonly status: "error"; readonly error: E } {
    return this.isOk()
      ? { status: "ok", value: this.value }
      : { status: "error", error: this.error as E };
  }
}

class Success<T> extends Result<T, never> {
  readonly status = "ok" as const;
  readonly error = undefined;

  constructor(readonly value: T) {
    super();
  }
}

class Failure<E extends Error> extends Result<never, E> {
  readonly status = "error" as const;
  readonly value = undefined;

  constructor(readonly error: E) {
    super();
  }
}

function success<T, E extends Error = never>(value: T): Result<T, E> {
  return new Success(value) as Result<T, E>;
}

function failure<T = never, E extends Error = Error>(error: E): Result<T, E> {
  return new Failure(error) as Result<T, E>;
}

function liftResult<T, E extends Error>(
  value: T | Result<T, E>,
): Result<T, E> {
  return Result.isResult(value) ? value as Result<T, E> : success(value);
}

function errorIdentity(error: Error): string {
  const branded = (error as Error & { readonly [ERROR_IDENTITY]?: unknown })[
    ERROR_IDENTITY
  ];
  if (typeof branded === "string") return branded;
  return error.constructor?.name || error.name || "Error";
}

function errorIs<C extends ErrorConstructor>(
  this: Error,
  constructor: C,
): this is InstanceType<C> {
  return this instanceof constructor;
}

function errorMatches(
  this: Error,
  ...constructors: readonly ErrorConstructor[]
): boolean {
  return constructors.some((constructor) => this instanceof constructor);
}

function errorMatch<R>(
  this: Error,
  handlers: ErrorMatchHandlers<Error, R>,
): R {
  const identity = errorIdentity(this);
  const handler =
    handlers[identity] ??
    handlers[this.name] ??
    handlers._ ??
    handlers.default;
  if (!handler) throw new UnhandledErrorMatch(this);
  return handler(this);
}

function errorMatchPartial<R>(
  this: Error,
  handlers: Readonly<Record<string, (error: Error) => R>>,
  fallback: (error: Error) => R,
): R {
  const handler = handlers[errorIdentity(this)] ?? handlers[this.name];
  return handler ? handler(this) : fallback(this);
}

function errorRootCause(this: Error): unknown {
  let current: unknown = this;
  const seen = new Set<unknown>();
  while (
    current instanceof Error &&
    current.cause !== undefined &&
    !seen.has(current)
  ) {
    seen.add(current);
    current = current.cause;
  }
  return current;
}

function installErrorMethods(): void {
  const methods: PropertyDescriptorMap = {
    is: { value: errorIs, configurable: true, writable: true },
    matches: { value: errorMatches, configurable: true, writable: true },
    match: { value: errorMatch, configurable: true, writable: true },
    matchPartial: {
      value: errorMatchPartial,
      configurable: true,
      writable: true,
    },
    rootCause: {
      value: errorRootCause,
      configurable: true,
      writable: true,
    },
  };
  for (const [name, descriptor] of Object.entries(methods)) {
    if (!(name in Error.prototype)) {
      Object.defineProperty(Error.prototype, name, descriptor);
    }
  }
}

declare global {
  interface Error {
    is<C extends ErrorConstructor>(
      constructor: C,
    ): this is InstanceType<C>;
    matches(...constructors: readonly ErrorConstructor[]): boolean;
    match<R>(handlers: ErrorMatchHandlers<this, R>): R;
    matchPartial<R>(
      handlers: Readonly<Record<string, (error: this) => R>>,
      fallback: (error: this) => R,
    ): R;
    rootCause(): unknown;
  }
}

installErrorMethods();

/** Compiler lowering targets; not part of ordinary VibeLang authoring. */
export const __resultSuccess = success;
export const __resultError = failure;
export const __setErrorIdentity = (
  error: Error,
  identity: string,
): void => {
  Object.defineProperty(error, ERROR_IDENTITY, {
    value: identity,
    configurable: false,
    enumerable: false,
    writable: false,
  });
};

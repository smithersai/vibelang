import {
  Result,
  __resultError,
  __resultSuccess,
} from "./result.js";

const OPTIONAL_BRAND = Symbol.for("vibelang.optional");

export interface OptionalMatcher<T, A, B = A> {
  readonly some: (value: T) => A;
  readonly none: () => B;
}

export type InferOptionalValue<O> = O extends Optional<infer T> ? T : never;

export class MissingOptionalValue extends Error {
  constructor(message = "Expected an Optional value to be present") {
    super(message);
    this.name = "MissingOptionalValue";
  }
}

/**
 * Built-in optional value. VibeLang source normally creates variants with
 * plain `return value` and `return null` inside Optional-returning functions.
 */
export abstract class Optional<T> {
  abstract readonly status: "some" | "none";
  abstract readonly value: T | undefined;
  readonly [OPTIONAL_BRAND] = true;

  static isOptional(value: unknown): value is Optional<unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      OPTIONAL_BRAND in value
    );
  }

  static fromNullable<T>(value: T | null | undefined): Optional<NonNullable<T>> {
    return value === null || value === undefined
      ? absent()
      : present(value as NonNullable<T>);
  }

  static all<const Values extends readonly Optional<unknown>[]>(
    values: Values,
  ): Optional<{ readonly [K in keyof Values]: InferOptionalValue<Values[K]> }> {
    const presentValues: unknown[] = [];
    for (const value of values) {
      if (value.isNone()) return absent();
      presentValues.push(value.value);
    }
    return present(presentValues) as Optional<{
      readonly [K in keyof Values]: InferOptionalValue<Values[K]>;
    }>;
  }

  isSome(): this is this & { readonly status: "some"; readonly value: T } {
    return this.status === "some";
  }

  isNone(): this is this & { readonly status: "none" } {
    return this.status === "none";
  }

  match<A, B = A>(matcher: OptionalMatcher<T, A, B>): A | B {
    return this.isSome() ? matcher.some(this.value) : matcher.none();
  }

  map<U>(transform: (value: T) => U): Optional<U> {
    return this.isSome() ? present(transform(this.value)) : absent();
  }

  andThen<U>(
    transform: (value: T) => U | null | undefined | Optional<U>,
  ): Optional<U> {
    if (this.isNone()) return absent();
    return liftOptional(transform(this.value as T));
  }

  filter(predicate: (value: T) => boolean): Optional<T> {
    return this.isSome() && predicate(this.value) ? this : absent();
  }

  tap(observe: (value: T) => void): Optional<T> {
    if (this.isSome()) observe(this.value);
    return this;
  }

  /**
   * The VibeLang compiler treats this as absence propagation in an
   * Optional-returning function. The JavaScript fallback throws visibly.
   */
  unwrap(message?: string): T {
    if (this.isSome()) return this.value;
    throw new MissingOptionalValue(message);
  }

  unwrapOr<U>(fallback: U | (() => U)): T | U {
    if (this.isSome()) return this.value;
    return typeof fallback === "function"
      ? (fallback as () => U)()
      : fallback;
  }

  toResult<E extends Error>(error: E | (() => E)): Result<T, E> {
    if (this.isSome()) return __resultSuccess(this.value);
    return __resultError(typeof error === "function" ? (error as () => E)() : error);
  }

  toNullable(): T | null {
    return this.isSome() ? this.value : null;
  }

  toJSON():
    | { readonly status: "some"; readonly value: T }
    | { readonly status: "none" } {
    return this.isSome()
      ? { status: "some", value: this.value }
      : { status: "none" };
  }
}

class Present<T> extends Optional<T> {
  readonly status = "some" as const;

  constructor(readonly value: T) {
    super();
  }
}

class Absent extends Optional<never> {
  readonly status = "none" as const;
  readonly value = undefined;
}

const NONE = new Absent();

function present<T>(value: T): Optional<T> {
  return new Present(value);
}

function absent<T = never>(): Optional<T> {
  return NONE as Optional<T>;
}

function liftOptional<T>(
  value: T | null | undefined | Optional<T>,
): Optional<T> {
  if (Optional.isOptional(value)) return value as Optional<T>;
  return value === null || value === undefined ? absent() : present(value);
}

/** Compiler lowering targets; not part of ordinary VibeLang authoring. */
export const __optionalPresent = present;
export const __optionalAbsent = absent;

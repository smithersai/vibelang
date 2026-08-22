import { __vsResultFailure, __vsResultSuccess, type Result } from "./result.ts";
import { type NominalError, isLocalError, registerErrorCodec } from "./errors.ts";
import { Panic, panic } from "./panic.ts";

type OptionalState<T> = { readonly some: true; readonly value: T } | { readonly some: false };
const states = new WeakMap<object, OptionalState<unknown>>();
const localOptionals = new WeakSet<object>();

export class MissingOptionalValue extends Panic {
  constructor(message = "Optional.unwrap() was called on an absent value") {
    super(message);
    this.name = "MissingOptionalValue";
  }
}
/** Nominal brand: keeps `errorIs(error, MissingOptionalValue)` from matching a bare Panic. */
export interface MissingOptionalValue extends NominalError<"vibelang:MissingOptionalValue@1"> {}

registerErrorCodec(MissingOptionalValue, "vibelang:MissingOptionalValue@1", {
  encode: (error) => ({ message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 1 || typeof payload.message !== "string"
    ) throw new TypeError("invalid MissingOptionalValue payload");
    return new MissingOptionalValue(payload.message);
  },
});

function stateOf<T>(optional: Optional<T>): OptionalState<T> {
  const state = states.get(optional as object);
  if (!state || !localOptionals.has(optional as object)) panic("forged Optional value");
  return state as OptionalState<T>;
}

export abstract class OptionalValue<T> {
  isSome(): boolean { return stateOf(this).some; }
  isNone(): boolean { return !stateOf(this).some; }

  match<Some, None>(handlers: { readonly some: (value: T) => Some; readonly none: () => None }): Some | None {
    if (typeof handlers?.some !== "function" || typeof handlers.none !== "function") {
      panic("Optional.match requires some and none handlers");
    }
    const state = stateOf(this);
    return state.some ? handlers.some(state.value) : handlers.none();
  }

  map<B>(mapper: (value: T) => B | null | undefined): Optional<B> {
    const state = stateOf(this);
    return state.some ? fromNullable(mapper(state.value)) : noneValue as Optional<B>;
  }

  andThen<B>(mapper: (value: T) => Optional<B>): Optional<B> {
    const state = stateOf(this);
    if (!state.some) return noneValue as Optional<B>;
    const next = mapper(state.value);
    if (!isOptional(next)) panic("Optional.andThen callback did not return an Optional");
    return next;
  }

  filter(predicate: (value: T) => boolean): Optional<T> {
    const state = stateOf(this);
    return state.some && predicate(state.value) ? this : noneValue as Optional<T>;
  }

  tap(observer: (value: T) => unknown): Optional<T> {
    const state = stateOf(this);
    if (state.some) observer(state.value);
    return this;
  }

  /** Missed-lowering fallback. The compiler normally emits an Optional early return. */
  unwrap(): T {
    const state = stateOf(this);
    if (state.some) return state.value;
    throw new MissingOptionalValue();
  }

  unwrapOr<B>(fallback: B | (() => B)): T | B {
    const state = stateOf(this);
    if (state.some) return state.value;
    return typeof fallback === "function" ? (fallback as () => B)() : fallback;
  }

  toResult<E extends Error>(error: E | (() => E)): Result<T, E> {
    const state = stateOf(this);
    if (state.some) return __vsResultSuccess(state.value);
    const failure = typeof error === "function" ? (error as () => E)() : error;
    if (!isLocalError(failure)) panic("Optional.toResult requires a local Error");
    return __vsResultFailure(failure);
  }

  toNullable(): T | null {
    const state = stateOf(this);
    return state.some ? state.value : null;
  }

  get [Symbol.toStringTag](): string { return "Optional"; }
}

export type Optional<T> = OptionalValue<T>;

class LocalOptional<T> extends OptionalValue<T> {
  constructor(state: OptionalState<T>) {
    super();
    states.set(this, Object.freeze(state) as OptionalState<unknown>);
    localOptionals.add(this);
    Object.freeze(this);
  }
}

const noneValue: Optional<never> = new LocalOptional({ some: false });

export function isOptional(value: unknown): value is Optional<unknown> {
  return typeof value === "object" && value !== null && localOptionals.has(value);
}

/** Compiler lowering hook; intentionally absent from the author-facing Optional namespace. */
export function __vsOptionalSome<T>(value: T): Optional<NonNullable<T>> {
  if (value === null || value === undefined) panic("Optional present value cannot be null or undefined");
  return new LocalOptional({ some: true, value: value as NonNullable<T> });
}

/** Compiler lowering hook; intentionally absent from the author-facing Optional namespace. */
export function __vsOptionalNone(): Optional<never> {
  return noneValue;
}

export type InspectedOptional<T> =
  | { readonly some: true; readonly value: T }
  | { readonly some: false };

/** Compiler hook used to lower `.unwrap()` to an explicit early Optional return. */
export function __vsInspectOptional<T>(optional: Optional<T>): InspectedOptional<T> {
  const state = stateOf(optional);
  return state.some
    ? Object.freeze({ some: true, value: state.value })
    : Object.freeze({ some: false });
}

function fromNullable<T>(value: T | null | undefined): Optional<NonNullable<T>> {
  return value === null || value === undefined ? noneValue : __vsOptionalSome(value);
}

function all<const Values extends readonly Optional<unknown>[]>(
  values: Values,
): Optional<{ -readonly [Index in keyof Values]: Values[Index] extends Optional<infer A> ? A : never }>;
function all<T>(values: Iterable<Optional<T>>): Optional<T[]>;
function all(values: Iterable<Optional<unknown>>): Optional<unknown[]> {
  const output: unknown[] = [];
  for (const value of values) {
    if (!isOptional(value)) panic("Optional.all received a forged Optional value");
    const state = stateOf(value);
    if (!state.some) return noneValue;
    output.push(state.value);
  }
  return __vsOptionalSome(output);
}

export const Optional = Object.freeze({ fromNullable, all });

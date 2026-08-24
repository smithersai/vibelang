/** @module @throws {DecodeError} */
/**
 * Provisional ordinary-value codecs. A Codec is a frozen, locally branded
 * bidirectional pair; decoding is the recoverable boundary and never throws for
 * malformed wire data.
 */
import {
  RuntimeValues,
  isResult,
  registerErrorCodec,
  type JsonValue,
  type NominalError,
} from "../runtime/index.ts";
import type { Result } from "../runtime/result.ts";
import { isPanic, panic } from "../runtime/panic.ts";

const { failure, success } = RuntimeValues;

export type DecodePathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function renderPath(path: readonly DecodePathSegment[]): string {
  let pointer = "$";
  for (const segment of path) {
    pointer += typeof segment === "number"
      ? `[${segment}]`
      : IDENTIFIER.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }
  return pointer;
}

function checkedPath(path: readonly DecodePathSegment[]): readonly DecodePathSegment[] {
  if (!Array.isArray(path)) throw new TypeError("DecodeError path must be an array");
  return Object.freeze(path.map((segment) => {
    if (typeof segment === "string") return segment;
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) return segment;
    throw new TypeError("DecodeError path segments must be strings or array indices");
  }));
}

export class DecodeError extends Error {
  readonly path: readonly DecodePathSegment[];
  readonly pointer: string;
  readonly reason: string;

  constructor(path: readonly DecodePathSegment[], reason: string) {
    const checked = checkedPath(path);
    const pointer = renderPath(checked);
    super(`${pointer} ${reason}`);
    this.name = "DecodeError";
    this.path = checked;
    this.pointer = pointer;
    this.reason = reason;
  }
}
export interface DecodeError extends NominalError<"smithers:DecodeError@1"> {}

registerErrorCodec(DecodeError, "smithers:DecodeError@1", {
  encode: (error): JsonValue => ({ path: [...error.path], reason: error.reason }),
  decode: (payload) => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("DecodeError payload must be an object");
    }
    const keys = Object.keys(payload).sort();
    if (keys.length !== 2 || keys[0] !== "path" || keys[1] !== "reason") {
      throw new TypeError("DecodeError payload has unexpected fields");
    }
    if (!Array.isArray(payload.path) || typeof payload.reason !== "string") {
      throw new TypeError("DecodeError payload requires a path array and reason string");
    }
    return new DecodeError(payload.path as DecodePathSegment[], payload.reason);
  },
});

type ErasedCodecState = {
  readonly encode: (value: unknown) => unknown;
  readonly decode: (wire: unknown) => Result<unknown, DecodeError>;
  readonly accepts: (value: unknown) => boolean;
};

const states = new WeakMap<object, ErasedCodecState>();
const localCodecs = new WeakSet<object>();

function stateOf<Domain, Wire>(codec: Codec<Domain, Wire>): ErasedCodecState {
  const state = states.get(codec as object);
  if (!state || !localCodecs.has(codec as object)) panic("forged Codec value");
  return state;
}

export abstract class CodecValue<Domain, Wire> {
  encode(value: Domain): Wire {
    return stateOf(this).encode(value) as Wire;
  }

  decode(wire: Wire): Result<Domain, DecodeError> {
    try {
      const decoded = stateOf(this).decode(wire);
      if (!isResult(decoded)) panic("Codec decoder did not return a Result");
      return decoded as Result<Domain, DecodeError>;
    } catch (cause) {
      if (isPanic(cause)) throw cause;
      return failure(new DecodeError([], "decoder could not inspect wire safely"));
    }
  }

  map<Next>(
    decodeMap: (value: Domain) => Result<Next, DecodeError>,
    encodeMap: (value: Next) => Domain,
  ): Codec<Next, Wire> {
    return map(this, decodeMap, encodeMap);
  }

  imap<Next>(decodeMap: (value: Domain) => Next, encodeMap: (value: Next) => Domain): Codec<Next, Wire> {
    return imap(this, decodeMap, encodeMap);
  }

  compose<NextWire>(next: Codec<Wire, NextWire>): Codec<Domain, NextWire> {
    return compose(this, next);
  }

  get [Symbol.toStringTag](): string { return "Codec"; }
}

export type Codec<Domain, Wire> = CodecValue<Domain, Wire>;

class LocalCodec<Domain, Wire> extends CodecValue<Domain, Wire> {
  constructor(state: ErasedCodecState) {
    super();
    states.set(this, Object.freeze(state));
    localCodecs.add(this);
    Object.freeze(this);
  }
}

function requireFunction(value: unknown, label: string): asserts value is (...arguments_: never[]) => unknown {
  if (typeof value !== "function") panic(`${label} requires a function`);
}

function make<Domain, Wire>(
  encode: (value: Domain) => Wire,
  decode: (wire: Wire) => Result<Domain, DecodeError>,
  accepts?: (value: unknown) => value is Domain,
): Codec<Domain, Wire> {
  requireFunction(encode, "Codec.make encode");
  requireFunction(decode, "Codec.make decode");
  if (accepts !== undefined) requireFunction(accepts, "Codec.make accepts");
  return new LocalCodec({
    encode: encode as (value: unknown) => unknown,
    decode: (wire) => {
      const result = decode(wire as Wire);
      if (!isResult(result)) panic("Codec.make decoder did not return a Result");
      return result as Result<unknown, DecodeError>;
    },
    accepts: accepts ?? ((value) => {
      // A lawful user codec can identify its own domain by a guarded probe. An
      // explicit predicate is preferable for unions because it avoids work and
      // resolves intentionally lossy/overlapping representations.
      try {
        const encoded = encode(value as Domain);
        const decoded = decode(encoded);
        if (!isResult(decoded) || decoded.isError()) return false;
        return roundTripEqual(value, decoded.unwrap());
      } catch (cause) {
        if (isPanic(cause)) throw cause;
        return false;
      }
    }),
  });
}

function local<Domain, Wire>(state: {
  readonly encode: (value: Domain) => Wire;
  readonly decode: (wire: Wire) => Result<Domain, DecodeError>;
  readonly accepts: (value: unknown) => boolean;
}): Codec<Domain, Wire> {
  return new LocalCodec(state as ErasedCodecState);
}

function fail<Domain = never>(path: readonly DecodePathSegment[], reason: string): Result<Domain, DecodeError> {
  return failure(new DecodeError(path, reason));
}

function prepend<Domain>(
  result: Result<Domain, DecodeError>,
  segment: DecodePathSegment,
): Result<Domain, DecodeError> {
  return result.match({
    ok: (value) => success(value),
    error: (error) => failure(new DecodeError([segment, ...error.path], error.reason)),
  });
}

function map<Domain, Next, Wire>(
  codec: Codec<Domain, Wire>,
  decodeMap: (value: Domain) => Result<Next, DecodeError>,
  encodeMap: (value: Next) => Domain,
): Codec<Next, Wire> {
  requireFunction(decodeMap, "Codec.map decodeMap");
  requireFunction(encodeMap, "Codec.map encodeMap");
  const state = stateOf(codec);
  return local({
    encode: (value) => state.encode(encodeMap(value)) as Wire,
    decode: (wire) => {
      const decoded = state.decode(wire);
      return decoded.match({
        ok: (value) => {
          const mapped = decodeMap(value as Domain);
          if (!isResult(mapped)) panic("Codec.map callback did not return a Result");
          return mapped;
        },
        error: (error) => failure(error),
      });
    },
    accepts: (value) => {
      try {
        return state.accepts(encodeMap(value as Next));
      } catch (cause) {
        if (isPanic(cause)) throw cause;
        return false;
      }
    },
  });
}

function imap<Domain, Next, Wire>(
  codec: Codec<Domain, Wire>,
  decodeMap: (value: Domain) => Next,
  encodeMap: (value: Next) => Domain,
): Codec<Next, Wire> {
  requireFunction(decodeMap, "Codec.imap decodeMap");
  requireFunction(encodeMap, "Codec.imap encodeMap");
  return map(codec, (value) => success(decodeMap(value)), encodeMap);
}

function compose<Domain, Middle, Wire>(
  first: Codec<Domain, Middle>,
  second: Codec<Middle, Wire>,
): Codec<Domain, Wire> {
  const left = stateOf(first);
  const right = stateOf(second);
  return local({
    encode: (value) => right.encode(left.encode(value)) as Wire,
    decode: (wire) => right.decode(wire).andThen((middle) => left.decode(middle) as Result<Domain, DecodeError>),
    accepts: left.accepts,
  });
}

function scalar<Domain>(name: string, accepts: (value: unknown) => value is Domain): Codec<Domain, Domain> {
  return local({
    encode: (value) => {
      if (!accepts(value)) throw new TypeError(`Codec.${name}.encode expected ${name}`);
      return value;
    },
    decode: (wire) => accepts(wire) ? success(wire) : fail([], `expected ${name}`),
    accepts,
  });
}

const stringCodec = scalar("string", (value): value is string => typeof value === "string");
const numberCodec = scalar("finite number", (value): value is number => typeof value === "number" && Number.isFinite(value));
const booleanCodec = scalar("boolean", (value): value is boolean => typeof value === "boolean");
const nullCodec = scalar("null", (value): value is null => value === null);

function literal<const Value extends string | number | boolean>(value: Value): Codec<Value, Value> {
  if (!(typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) {
    panic("Codec.literal requires a finite string, number, or boolean");
  }
  const expected = JSON.stringify(value);
  return scalar(expected, (candidate): candidate is Value => candidate === value);
}

type DomainOf<C> = C extends CodecValue<infer Domain, any> ? Domain : never;
type WireOf<C> = C extends CodecValue<any, infer Wire> ? Wire : never;

function array<Domain, Wire>(item: Codec<Domain, Wire>): Codec<readonly Domain[], readonly Wire[]> {
  const child = stateOf(item);
  return local({
    encode: (values) => {
      if (!isPlainArray(values)) throw new TypeError("Codec.array.encode expected a plain array");
      for (let index = 0; index < values.length; index += 1) {
        if (!Object.hasOwn(values, index)) throw new TypeError(`Codec.array.encode found a sparse hole at ${index}`);
      }
      return Object.freeze(values.map((value) => child.encode(value) as Wire));
    },
    decode: (wire) => {
      if (!isPlainArray(wire)) return fail([], "expected a plain array");
      const output: Domain[] = [];
      for (let index = 0; index < wire.length; index += 1) {
        if (!Object.hasOwn(wire, index)) return fail([index], "is a sparse array hole");
        const decoded = prepend(child.decode(wire[index]) as Result<Domain, DecodeError>, index);
        if (decoded.isError()) return decoded as Result<readonly Domain[], DecodeError>;
        output.push(decoded.unwrap());
      }
      return success(Object.freeze(output));
    },
    accepts: (value) => isPlainArray(value) && value.every(child.accepts),
  });
}

function tuple<const Parts extends readonly CodecValue<any, any>[]>(
  ...parts: Parts
): Codec<Readonly<{ [Index in keyof Parts]: DomainOf<Parts[Index]> }>, Readonly<{ [Index in keyof Parts]: WireOf<Parts[Index]> }>> {
  const children = parts.map(stateOf);
  return local({
    encode: (values) => {
      if (!isPlainArray(values) || values.length !== children.length) {
        throw new TypeError(`Codec.tuple.encode expected a ${children.length}-element plain tuple`);
      }
      return Object.freeze(children.map((child, index) => child.encode(values[index]))) as never;
    },
    decode: (wire) => {
      const values: unknown = wire;
      if (!isPlainArray(values)) return fail([], "expected a plain tuple");
      if (values.length !== children.length) {
        return fail([], `expected a ${children.length}-element tuple but received ${values.length}`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < children.length; index += 1) {
        if (!Object.hasOwn(values, index)) return fail([index], "is a sparse tuple hole");
        const decoded = prepend(children[index]!.decode(values[index]), index);
        if (decoded.isError()) return decoded as never;
        output.push(decoded.unwrap());
      }
      return success(Object.freeze(output)) as never;
    },
    accepts: (value) => isPlainArray(value) && value.length === children.length &&
      children.every((child, index) => child.accepts(value[index])),
  });
}

function isPlainArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
  }
  return true;
}

function dataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownData(value: object, key: string): unknown | typeof NO_DATA {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor && descriptor.enumerable ? descriptor.value : NO_DATA;
}

const NO_DATA = Symbol("no data");

function struct<const Fields extends Readonly<Record<string, CodecValue<any, any>>>>(
  fields: Fields,
): Codec<
  Readonly<{ [Key in keyof Fields]: DomainOf<Fields[Key]> }>,
  Readonly<{ [Key in keyof Fields]: WireOf<Fields[Key]> }>
> {
  if (!dataRecord(fields)) panic("Codec.struct requires a record of Codec values");
  const entries = Object.keys(fields).map((key) => [key, stateOf(fields[key]!)] as const);
  const names = new Set(entries.map(([key]) => key));
  const checkShape = (value: unknown): value is Record<string, unknown> => {
    if (!dataRecord(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== entries.length || keys.some((key) => typeof key !== "string" || !names.has(key))) return false;
    return entries.every(([key]) => ownData(value, key) !== NO_DATA);
  };
  return local({
    encode: (value) => {
      if (!checkShape(value)) throw new TypeError("Codec.struct.encode expected exactly the declared data fields");
      const output = Object.create(null) as Record<string, unknown>;
      for (const [key, child] of entries) {
        Object.defineProperty(output, key, {
          value: child.encode(ownData(value, key)), enumerable: true, configurable: false, writable: false,
        });
      }
      return Object.freeze(output) as never;
    },
    decode: (wire) => {
      if (!dataRecord(wire)) return fail([], "expected a plain object");
      for (const key of Reflect.ownKeys(wire)) {
        if (typeof key !== "string") return fail([], "expected an object without symbol-keyed properties");
        if (!names.has(key)) return fail([key], "is not declared by the codec");
      }
      const output: Record<string, unknown> = {};
      for (const [key, child] of entries) {
        const value = ownData(wire, key);
        if (value === NO_DATA) return fail([key], "is required and must be an enumerable data property");
        const decoded = prepend(child.decode(value), key);
        if (decoded.isError()) return decoded as never;
        Object.defineProperty(output, key, {
          value: decoded.unwrap(), enumerable: true, configurable: false, writable: false,
        });
      }
      return success(Object.freeze(output)) as never;
    },
    accepts: (value) => checkShape(value) && entries.every(([key, child]) => child.accepts(ownData(value, key))),
  });
}

function union<const Members extends readonly CodecValue<any, any>[]>(
  ...members: Members
): Codec<DomainOf<Members[number]>, WireOf<Members[number]>> {
  if (members.length < 2) panic("Codec.union requires at least two codecs");
  const variants = members.map(stateOf);
  return local({
    encode: (value) => {
      const selected = variants.find((variant) => variant.accepts(value));
      if (!selected) throw new TypeError("Codec.union.encode value matches no variant");
      return selected.encode(value) as never;
    },
    decode: (wire) => {
      const reasons: string[] = [];
      for (const variant of variants) {
        const decoded = variant.decode(wire);
        if (decoded.isOk()) return decoded as never;
        decoded.match({ ok: () => undefined, error: (error) => reasons.push(error.reason) });
      }
      return fail([], `did not match any union variant (${reasons.join("; ")})`);
    },
    accepts: (value) => variants.some((variant) => variant.accepts(value)),
  });
}

function nullable<Domain, Wire>(codec: Codec<Domain, Wire>): Codec<Domain | null, Wire | null> {
  return union(codec as CodecValue<any, any>, nullCodec) as Codec<Domain | null, Wire | null>;
}

/**
 * A codec over `Domain | undefined`. Absence is the ordinary union member and
 * travels as a missing/`undefined` wire value; there is no container to build
 * (specification/type-system.mdx, "Absence").
 */
function optional<Domain, Wire>(codec: Codec<Domain, Wire>): Codec<Domain | undefined, Wire | undefined> {
  const child = stateOf(codec);
  return local({
    encode: (value) => (value === undefined ? undefined : child.encode(value) as Wire),
    decode: (wire) => {
      if (wire === undefined) return success(undefined);
      return child.decode(wire) as Result<Domain | undefined, DecodeError>;
    },
    accepts: (value) => value === undefined || child.accepts(value),
  });
}

function roundTripEqual(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (left === right || (left !== left && right !== right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => roundTripEqual(value, right[index], seen));
  }
  if (!dataRecord(left) || !dataRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && roundTripEqual(left[key], right[key], seen));
}

/** Returns the first law violation, or `undefined` when every sample round-trips. */
function checkRoundTrip<Domain, Wire>(codec: Codec<Domain, Wire>, samples: readonly Domain[]): string | undefined {
  const state = stateOf(codec);
  if (!Array.isArray(samples)) panic("Codec.checkRoundTrip requires an array of samples");
  for (let index = 0; index < samples.length; index += 1) {
    let wire: unknown;
    try {
      wire = state.encode(samples[index]);
    } catch (cause) {
      return `encode threw at sample ${index}: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    let decoded: Result<unknown, DecodeError>;
    try {
      decoded = state.decode(wire);
    } catch (cause) {
      if (isPanic(cause)) throw cause;
      return `decode threw at sample ${index}: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    if (decoded.isError()) {
      return decoded.match({ ok: () => "", error: (error) => `decode failed at sample ${index}: ${error.message}` });
    }
    if (!roundTripEqual(samples[index], decoded.unwrap())) return `round-trip changed sample ${index}`;
  }
  return undefined;
}

export function isCodec(value: unknown): value is Codec<unknown, unknown> {
  return typeof value === "object" && value !== null && localCodecs.has(value);
}

export const Codec = Object.freeze({
  make,
  isCodec,
  string: stringCodec,
  number: numberCodec,
  boolean: booleanCodec,
  null: nullCodec,
  literal,
  map,
  imap,
  compose,
  array,
  tuple,
  struct,
  union,
  nullable,
  optional,
  checkRoundTrip,
});

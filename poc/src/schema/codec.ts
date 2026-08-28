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
import {
  arrayHoleIndex,
  denseArray,
  isDenseArray,
  itemAt,
  NO_HOLE,
  requireDenseArray,
  sameArrayShape,
} from "../data/array-shape.ts";

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
  // `.map` never calls its callback on a hole, so the segment check below would
  // be skipped for one and the hole would survive into a rendered pointer.
  const segments = denseArray(path, () => {
    throw new TypeError("DecodeError path segments must be strings or array indices");
  });
  return Object.freeze(segments.map((segment) => {
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

// ---------------------------------------------------------------------------
// Optional struct fields
// ---------------------------------------------------------------------------

const optionalFields = new WeakMap<object, Codec<unknown, unknown>>();
const localOptionalFields = new WeakSet<object>();

/**
 * The marker for a struct field that may be **absent**, and the counterpart of
 * `Schema.optional`.
 *
 * It is deliberately *not* a `Codec`. A `Codec<Domain | undefined, ...>` — which
 * is what `Codec.optional` builds — describes a field that is always present and
 * sometimes holds `undefined`, and JSON has no way to spell that: encoding it
 * produces a wire `Json.stringify` refuses, and the key-omitted form JSON does
 * carry cannot be decoded back. Absence in a record is the *key not being there*,
 * so the marker has to be read by `Codec.struct` rather than by a member codec,
 * which is why it lives at the field position and carries no `encode`/`decode`
 * of its own.
 */
export abstract class OptionalCodecValue<Domain, Wire> {
  get codec(): Codec<Domain, Wire> {
    return optionalFieldCodec(this as OptionalCodec<Domain, Wire>);
  }

  get [Symbol.toStringTag](): string { return "OptionalCodec"; }
}

export type OptionalCodec<Domain, Wire> = OptionalCodecValue<Domain, Wire>;

class LocalOptionalCodec<Domain, Wire> extends OptionalCodecValue<Domain, Wire> {
  constructor(codec: Codec<Domain, Wire>) {
    super();
    stateOf(codec);
    optionalFields.set(this, codec as Codec<unknown, unknown>);
    localOptionalFields.add(this);
    Object.freeze(this);
  }
}

function optionalFieldCodec<Domain, Wire>(value: OptionalCodec<Domain, Wire>): Codec<Domain, Wire> {
  const codec = optionalFields.get(value as object);
  if (!codec || !localOptionalFields.has(value as object)) panic("forged optional Codec field");
  return codec as Codec<Domain, Wire>;
}

export function isOptionalCodec(value: unknown): value is OptionalCodec<unknown, unknown> {
  return typeof value === "object" && value !== null && localOptionalFields.has(value);
}

/** Mark a `Codec.struct` field as one whose absence is an omitted key. */
function optionalField<Domain, Wire>(codec: Codec<Domain, Wire>): OptionalCodec<Domain, Wire> {
  return new LocalOptionalCodec(codec);
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
      const items = denseArray(values, (index) => {
        throw new TypeError(`Codec.array.encode found a sparse hole at ${index}`);
      });
      return Object.freeze(items.map((value) => child.encode(value) as Wire));
    },
    decode: (wire) => {
      if (!isPlainArray(wire)) return fail([], "expected a plain array");
      const hole = arrayHoleIndex(wire);
      if (hole !== NO_HOLE) return fail([hole], "is a sparse array hole");
      const output: Domain[] = [];
      for (let index = 0; index < wire.length; index += 1) {
        const decoded = prepend(child.decode(wire[index]) as Result<Domain, DecodeError>, index);
        if (decoded.isError()) return decoded as Result<readonly Domain[], DecodeError>;
        output.push(decoded.unwrap());
      }
      return success(Object.freeze(output));
    },
    // `.every` skips a hole and is vacuously true over one, so this used to
    // claim a value the encoder immediately refused -- and `accepts` is what
    // picks a union variant, so the disagreement escaped as a raw TypeError.
    accepts: (value) => isPlainArray(value) && isDenseArray(value) && value.every((item) => child.accepts(item)),
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
      // The walk is over `children`, so `values[index]` reads a hole as
      // `undefined` and the encoded tuple gains an own property the input never
      // had. Gating the *input* is what stops the shape changing.
      const items = denseArray(values, (index) => {
        throw new TypeError(`Codec.tuple.encode found a sparse hole at ${index}`);
      });
      return Object.freeze(children.map((child, index) => child.encode(itemAt(items, index)))) as never;
    },
    decode: (wire) => {
      const values: unknown = wire;
      if (!isPlainArray(values)) return fail([], "expected a plain tuple");
      if (values.length !== children.length) {
        return fail([], `expected a ${children.length}-element tuple but received ${values.length}`);
      }
      const hole = arrayHoleIndex(values);
      if (hole !== NO_HOLE) return fail([hole], "is a sparse tuple hole");
      const output: unknown[] = [];
      for (let index = 0; index < children.length; index += 1) {
        const decoded = prepend(children[index]!.decode(values[index]), index);
        if (decoded.isError()) return decoded as never;
        output.push(decoded.unwrap());
      }
      return success(Object.freeze(output)) as never;
    },
    accepts: (value) => isPlainArray(value) && value.length === children.length && isDenseArray(value) &&
      children.every((child, index) => child.accepts(itemAt(value, index))),
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

type StructEntry = CodecValue<any, any> | OptionalCodecValue<any, any>;

type RequiredFieldKeys<Fields extends Readonly<Record<string, StructEntry>>> = {
  [Key in keyof Fields]-?: Fields[Key] extends OptionalCodecValue<any, any> ? never : Key
}[keyof Fields];
type OptionalFieldKeys<Fields extends Readonly<Record<string, StructEntry>>> = {
  [Key in keyof Fields]-?: Fields[Key] extends OptionalCodecValue<any, any> ? Key : never
}[keyof Fields];
type EntryDomain<Entry> = Entry extends OptionalCodecValue<infer Domain, any> ? Domain
  : Entry extends CodecValue<infer Domain, any> ? Domain : never;
type EntryWire<Entry> = Entry extends OptionalCodecValue<any, infer Wire> ? Wire
  : Entry extends CodecValue<any, infer Wire> ? Wire : never;

export type StructDomain<Fields extends Readonly<Record<string, StructEntry>>> = Readonly<
  { [Key in RequiredFieldKeys<Fields>]: EntryDomain<Fields[Key]> } &
  { [Key in OptionalFieldKeys<Fields>]?: EntryDomain<Fields[Key]> }
>;
export type StructWire<Fields extends Readonly<Record<string, StructEntry>>> = Readonly<
  { [Key in RequiredFieldKeys<Fields>]: EntryWire<Fields[Key]> } &
  { [Key in OptionalFieldKeys<Fields>]?: EntryWire<Fields[Key]> }
>;

interface StructField {
  readonly name: string;
  readonly optional: boolean;
  readonly state: ErasedCodecState;
}

function struct<const Fields extends Readonly<Record<string, StructEntry>>>(
  fields: Fields,
): Codec<StructDomain<Fields>, StructWire<Fields>> {
  if (!dataRecord(fields)) panic("Codec.struct requires a record of Codec values");
  const entries: readonly StructField[] = Object.keys(fields).map((name) => {
    const entry = fields[name]!;
    return Object.freeze(isOptionalCodec(entry)
      ? { name, optional: true, state: stateOf(optionalFieldCodec(entry)) }
      : { name, optional: false, state: stateOf(entry as Codec<unknown, unknown>) });
  });
  const names = new Set(entries.map((entry) => entry.name));
  /**
   * One predicate for "is this member present?", consulted by encode, decode,
   * and accepts alike. An optional field may be absent; a present one — optional
   * or not — must still be an enumerable data property, and no undeclared key is
   * ever allowed.
   */
  const checkShape = (value: unknown): value is Record<string, unknown> => {
    if (!dataRecord(value)) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !names.has(key)) return false;
    }
    return entries.every((entry) =>
      Object.hasOwn(value, entry.name) ? ownData(value, entry.name) !== NO_DATA : entry.optional);
  };
  return local({
    encode: (value) => {
      if (!checkShape(value)) throw new TypeError("Codec.struct.encode expected exactly the declared data fields");
      const output = Object.create(null) as Record<string, unknown>;
      for (const entry of entries) {
        const member = ownData(value, entry.name);
        // Absence is an omitted key. Encoding it as a present `undefined` is
        // what made an optional field impossible to carry over JSON.
        if (member === NO_DATA) continue;
        Object.defineProperty(output, entry.name, {
          value: entry.state.encode(member), enumerable: true, configurable: false, writable: false,
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
      for (const entry of entries) {
        const value = ownData(wire, entry.name);
        if (value === NO_DATA) {
          if (!entry.optional) return fail([entry.name], "is required and must be an enumerable data property");
          if (!Object.hasOwn(wire, entry.name)) continue;
          return fail([entry.name], "is optional but must be an enumerable data property when present");
        }
        const decoded = prepend(entry.state.decode(value), entry.name);
        if (decoded.isError()) return decoded as never;
        Object.defineProperty(output, entry.name, {
          value: decoded.unwrap(), enumerable: true, configurable: false, writable: false,
        });
      }
      return success(Object.freeze(output)) as never;
    },
    accepts: (value) => checkShape(value) && entries.every((entry) => {
      const member = ownData(value, entry.name);
      // `checkShape` already guarantees a required member is data, so a miss
      // here is an absent optional field, which the codec accepts.
      return member === NO_DATA || entry.state.accepts(member);
    }),
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
 * A codec over `Domain | undefined`: absence is the ordinary union member and
 * there is no container to build (specification/type-system.mdx, "Absence").
 *
 * The wire value for absence is `undefined`, which is a value JSON cannot carry.
 * That is fine where the wire never becomes JSON — a tuple slot, an array
 * element, or an in-process boundary — and it is the wrong tool for a **struct
 * field**, where absence means the key is not there. Use `Codec.optionalField`
 * for that; it is the marker `Codec.struct` reads, and it round-trips through
 * `Json.stringify`/`Json.parse` in both directions.
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
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    // `.every` skips a hole, so a round trip that turned one into an own
    // `undefined` used to be certified as unchanged. Ownership first, then
    // values -- and this comparator feeds both `checkRoundTrip` and the default
    // `accepts` a custom codec is identified by.
    if (!sameArrayShape(left, right)) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!roundTripEqual(left[index], right[index], seen)) return false;
    }
    return true;
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
  // A hole in the sample set would silently law-check `undefined` in its place.
  const cases = requireDenseArray(samples, "Codec.checkRoundTrip samples");
  for (let index = 0; index < cases.length; index += 1) {
    let wire: unknown;
    try {
      wire = state.encode(itemAt(cases, index));
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
  optionalField,
  isOptionalCodec,
  checkRoundTrip,
});

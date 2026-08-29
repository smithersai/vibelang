import {
  decodeError,
  encodeError,
  errorIs,
  type ErrorConstructor,
  type JsonValue,
  type NominalError,
} from "./errors.ts";
import {
  __vsInspectResult,
  __vsResultFailure,
  __vsResultSuccess,
  type Result,
} from "./result.ts";

const MAX_WIRE_BYTES = 1_048_576;
const MAX_JSON_DEPTH = 64;

/** A compiler-derived codec for the successful payload of an envelope. */
export interface ValueCodec<T> {
  readonly encode: (value: T) => JsonValue;
  readonly decode: (payload: JsonValue) => T;
}

export class ValueCodecError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "ValueCodecError";
  }
}
export interface ValueCodecError extends NominalError<"smithers:ValueCodecError@1"> {}

function assertJson(
  value: unknown,
  path = "$",
  depth = 0,
  seen = new Set<object>(),
): asserts value is JsonValue {
  if (depth > MAX_JSON_DEPTH) throw new ValueCodecError(`${path} exceeds the codec depth limit`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ValueCodecError(`${path} contains a non-finite number`);
    // The canonical printer below renders -0 as "0", so accepting it here would
    // change the value's identity in transit with no diagnostic. Durable JSON
    // rejects it; so does this wire (`durable/value.ts`, `schema/json.ts`).
    if (Object.is(value, -0)) throw new ValueCodecError(`${path} contains negative zero`);
    return;
  }
  if (typeof value !== "object") throw new ValueCodecError(`${path} is not JSON data`);
  if (seen.has(value)) throw new ValueCodecError(`${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new ValueCodecError(`${path} is not an ordinary JSON array`);
      }
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new ValueCodecError(`${path}[${index}] is a sparse array hole`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new ValueCodecError(`${path}[${index}] is not an enumerable data property`);
        }
        assertJson(descriptor.value, `${path}[${index}]`, depth + 1, seen);
      }
      const extras = Reflect.ownKeys(value).filter(
        (key) => key !== "length" && !(typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)),
      );
      if (extras.length > 0) throw new ValueCodecError(`${path} has non-JSON array properties`);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ValueCodecError(`${path} is not a plain JSON object`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new ValueCodecError(`${path} has a symbol key`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new ValueCodecError(`${path}.${key} is not an enumerable data property`);
      }
      assertJson(descriptor.value, `${path}.${key}`, depth + 1, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function stringifyJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        throw new ValueCodecError(`$[${index}] changed during encoding`);
      }
      return stringifyJson(descriptor.value as JsonValue);
    }).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new ValueCodecError(`$.${key} changed during encoding`);
    }
    return `${JSON.stringify(key)}:${stringifyJson(descriptor.value as JsonValue)}`;
  }).join(",")}}`;
}

function encodedPayload<T>(codec: ValueCodec<T>, value: T): JsonValue {
  if (typeof codec?.encode !== "function" || typeof codec.decode !== "function") {
    throw new TypeError("value codec must define encode and decode");
  }
  let payload: unknown;
  try {
    payload = codec.encode(value);
  } catch (cause) {
    throw new ValueCodecError("value codec failed to encode", { cause });
  }
  assertJson(payload, "$.value");
  return payload;
}

function decodedPayload<T>(codec: ValueCodec<T>, payload: JsonValue): T {
  if (typeof codec?.encode !== "function" || typeof codec.decode !== "function") {
    throw new TypeError("value codec must define encode and decode");
  }
  try {
    return codec.decode(payload);
  } catch (cause) {
    throw new ValueCodecError("value codec failed to decode", { cause });
  }
}

function finishWire(wire: string): string {
  if (Buffer.byteLength(wire, "utf8") > MAX_WIRE_BYTES) {
    throw new ValueCodecError("encoded value exceeds the wire limit");
  }
  return wire;
}

function parseWire(wire: string): Record<string, JsonValue> {
  if (typeof wire !== "string") throw new ValueCodecError("encoded value must be a string");
  if (Buffer.byteLength(wire, "utf8") > MAX_WIRE_BYTES) {
    throw new ValueCodecError("encoded value exceeds the wire limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(wire);
  } catch (cause) {
    throw new ValueCodecError("encoded value is not valid JSON", { cause });
  }
  assertJson(parsed);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new ValueCodecError("encoded value envelope must be an object");
  }
  return parsed;
}

function exactKeys(value: Record<string, JsonValue>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ValueCodecError("encoded value envelope has unexpected fields");
  }
}

/**
 * A field `exactKeys` has already proved present, as a `JsonValue`.
 *
 * `noUncheckedIndexedAccess` is mandatory (compatibility.mdx §Mandatory), so an
 * index read into a `Record<string, JsonValue>` is `JsonValue | undefined` and
 * the exact-keys check above is a narrowing the checker cannot see. §Mandatory's
 * own guidance is that such a read "MUST be narrowed, or read through an
 * extraction helper"; this is the helper.
 */
function requiredField(record: Record<string, JsonValue>, key: string): JsonValue {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new ValueCodecError(`encoded value envelope is missing the '${key}' field`);
  }
  return record[key] as JsonValue;
}

function assertCanonical(wire: string, canonical: string): void {
  if (wire !== canonical) throw new ValueCodecError("encoded value is not canonical JSON");
}

export function encodeResult<A, E extends Error>(result: Result<A, E>, codec: ValueCodec<A>): string {
  const inspected = __vsInspectResult(result);
  if (inspected.ok) {
    const payload = encodedPayload(codec, inspected.value);
    return finishWire(`{"version":1,"kind":"success","value":${stringifyJson(payload)}}`);
  }
  const error = encodeError(inspected.error);
  return finishWire(`{"version":1,"kind":"error","error":${JSON.stringify(error)}}`);
}

export function decodeResult<A>(wire: string, codec: ValueCodec<A>): Result<A, Error>;
export function decodeResult<A, E extends Error>(
  wire: string,
  codec: ValueCodec<A>,
  allowedErrors: readonly ErrorConstructor<E>[],
): Result<A, E>;
export function decodeResult<A, E extends Error>(
  wire: string,
  codec: ValueCodec<A>,
  allowedErrors?: readonly ErrorConstructor<E>[],
): Result<A, Error | E> {
  const envelope = parseWire(wire);
  if (envelope.version !== 1 || (envelope.kind !== "success" && envelope.kind !== "error")) {
    throw new ValueCodecError("encoded Result has an unsupported envelope");
  }
  if (envelope.kind === "success") {
    exactKeys(envelope, ["version", "kind", "value"]);
    const canonical = `{"version":1,"kind":"success","value":${stringifyJson(requiredField(envelope, "value"))}}`;
    assertCanonical(wire, canonical);
    return __vsResultSuccess(decodedPayload(codec, requiredField(envelope, "value")));
  }
  exactKeys(envelope, ["version", "kind", "error"]);
  if (typeof envelope.error !== "string") throw new ValueCodecError("encoded Result error must be a string");
  const canonical = `{"version":1,"kind":"error","error":${JSON.stringify(envelope.error)}}`;
  assertCanonical(wire, canonical);
  const error = decodeError(envelope.error);
  if (allowedErrors !== undefined) {
    if (allowedErrors.length === 0 || !allowedErrors.some((type) => errorIs(error, type))) {
      throw new ValueCodecError("decoded Result contained an Error outside its declared channel");
    }
  }
  return __vsResultFailure(error as E);
}

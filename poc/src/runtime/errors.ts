import { Panic, isPanic, makePanic, panic } from "./panic.ts";

export type ErrorConstructor<E extends Error = Error> = abstract new (...args: any[]) => E;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** The instance type a constructor produces, distributed over a union of constructors. */
export type ErrorInstance<T> = T extends ErrorConstructor<infer E> ? E : never;

declare const nominalErrorBrand: unique symbol;

/**
 * Declaration-level nominal brand for an Error class.
 *
 * Two `class X extends Error {}` declarations with the same fields are the same
 * *type* to TypeScript, so `errorIs(error, X)` cannot subtract `Y` from a union
 * in the else branch: every sibling looks assignable to `X` and the else branch
 * collapses to `never`. Declaring the brand alongside the class makes siblings
 * nominally distinct, so both branches of `is`/`matches`/`match` narrow.
 *
 * The brand is a phantom type-only member: it is never read, written, enumerated,
 * or encoded, so runtime object shapes and wire codecs are untouched.
 *
 * ```ts
 * export class FileNotFound extends FileError {}
 * export interface FileNotFound extends NominalError<"smithers:FileNotFound@1"> {}
 * registerErrorType(FileNotFound, "smithers:FileNotFound@1");
 * ```
 *
 * Rules:
 * - Use the class's stable transport identity as the brand identity when it has
 *   one, so the nominal key and the wire key cannot drift apart.
 * - Brand the concrete classes that must be told apart from their siblings and
 *   leave the shared abstract base unbranded: `errorIs(error, FileError)` still
 *   narrows correctly through an unbranded base. TypeScript rejects a class
 *   whose merged brand differs from an inherited one, so exactly one level of
 *   any inheritance chain may carry a brand.
 */
export interface NominalError<Identity extends string> {
  readonly [nominalErrorBrand]: { readonly [Key in Identity]: void };
}

export interface ErrorPayloadCodec<E extends Error> {
  readonly encode: (error: E) => JsonValue;
  readonly decode: (payload: JsonValue) => E;
}

interface ErrorRegistration<E extends Error = Error> {
  readonly id: string;
  readonly type: ErrorConstructor<E>;
  codec?: ErrorPayloadCodec<E>;
  /**
   * True when `codec` was derived by {@link __vsRegisterError} rather than
   * supplied by an author. A derived codec is a default, so an explicit
   * `registerErrorCodec` for the same type replaces it instead of colliding;
   * two explicit codecs still collide.
   */
  derivedCodec?: boolean;
}

const registrationsByType = new WeakMap<Function, ErrorRegistration<any>>();
const registrationsByPrototype = new WeakMap<object, ErrorRegistration<any>>();
const registrationsById = new Map<string, ErrorRegistration<any>>();

export class ErrorCodecError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "ErrorCodecError";
  }
}
export interface ErrorCodecError extends NominalError<"smithers:ErrorCodecError@1"> {}

export class UnhandledException extends Error {
  constructor(readonly thrown: unknown) {
    super("A foreign implementation threw unexpectedly", { cause: thrown });
    this.name = "UnhandledException";
  }
}
export interface UnhandledException extends NominalError<"smithers:UnhandledException@1"> {}

/**
 * A stable Error identity: an ECMAScript identifier alphabet plus the module
 * path punctuation the compiler mints identities from, bounded at 256 units.
 *
 * The letter classes are the Unicode ones on purpose. `class Café extends
 * Error {}` is an ordinary TypeScript class, and failures.mdx requires that
 * ANY named class extending `Error` be usable as a nominal recoverable error;
 * an ASCII-only identity alphabet made the compiler accept such a program and
 * then throw here while the emitted module was still loading — a clean compile
 * that cannot run. Widening the alphabet is strictly additive: every identity
 * the ASCII form admitted still validates, and whitespace, quotes, control
 * characters, and the other shapes that would break a wire key are still
 * refused because they are neither ID_Start/ID_Continue nor listed here.
 */
const STABLE_ERROR_IDENTITY = /^[\p{ID_Start}0-9$][\p{ID_Continue}$._/@:+-]{0,255}$/u;

function validateIdentity(id: string): void {
  if (!STABLE_ERROR_IDENTITY.test(id)) {
    throw new TypeError(`invalid stable Error identity: ${JSON.stringify(id)}`);
  }
}

function nativeInstanceOf(value: unknown, type: Function): boolean {
  try {
    return Boolean(Function.prototype[Symbol.hasInstance].call(type, value));
  } catch {
    return false;
  }
}

function isErrorConstructor(type: unknown): type is ErrorConstructor {
  return (
    typeof type === "function" &&
    typeof type.prototype === "object" &&
    type.prototype !== null &&
    (type === Error || nativeInstanceOf(type.prototype, Error))
  );
}

export function isLocalError(value: unknown): value is Error {
  return nativeInstanceOf(value, Error);
}

export function registerErrorType<E extends Error>(type: ErrorConstructor<E>, id: string): ErrorConstructor<E> {
  if (!isErrorConstructor(type)) {
    throw new TypeError("Error identity requires a class extending Error");
  }
  validateIdentity(id);
  const priorType = registrationsByType.get(type);
  const priorId = registrationsById.get(id);
  if (priorType && priorType.id !== id) {
    throw new TypeError(`Error constructor is already registered as ${priorType.id}`);
  }
  if (priorId && priorId.type !== type) {
    throw new TypeError(`stable Error identity ${id} is already registered`);
  }
  if (priorType) return type;
  const registration: ErrorRegistration<E> = { id, type };
  registrationsByType.set(type, registration);
  registrationsByPrototype.set(type.prototype, registration);
  registrationsById.set(id, registration);
  return type;
}

/**
 * Trusted compiler hook emitted once after each named Error class.
 *
 * It supplies both halves of the obligation in specification/failures.mdx,
 * "Error Classes": "The compiler MUST provide stable nominal identity, matching
 * metadata, **serialization evidence, and cross-realm transport metadata**
 * while preserving ordinary `Error` behavior." Identity and matching metadata
 * come from {@link registerErrorType}; the transport half is the derived codec
 * installed here.
 *
 * Deriving it is what specification/durable-execution.mdx, "Durable Boundary",
 * asks for: "Plain data SHOULD derive the contract automatically. Functions,
 * capabilities, process handles, and other ephemeral values MUST be rejected
 * unless they define an explicit durable representation." The derivation reads
 * the error's own enumerable data properties and lets {@link encodeError}'s
 * existing `assertJson` refuse everything else with a located
 * {@link ErrorCodecError}, so an ephemeral field is a diagnostic rather than a
 * silently dropped one.
 *
 * `registerErrorType` deliberately keeps its identity-only meaning: the MUST is
 * on the *compiler*, and a hand-written TypeScript module that asks for an
 * identity has not asked the compiler for anything.
 */
export function __vsRegisterError<E extends Error>(type: ErrorConstructor<E>, id: string): ErrorConstructor<E> {
  registerErrorType(type, id);
  const registration = registrationsByType.get(type) as ErrorRegistration<E> | undefined;
  if (registration && !registration.codec) {
    registration.codec = Object.freeze({
      encode: (error: E) => derivedErrorPayload(error),
      decode: (payload: JsonValue) => derivedErrorInstance(type, payload) as E,
    });
    registration.derivedCodec = true;
  }
  return type;
}

/**
 * The compiler-derived transport payload: `message` plus every own enumerable
 * data property.
 *
 * Own enumerable data properties are exactly the fields ordinary class syntax
 * produces — `constructor(readonly path: string)`, a field initializer, and the
 * `this.name = "X"` assignment a hand-written Error class makes. `message` is
 * added by name because JavaScript defines it non-enumerably, and `stack` is
 * excluded by name because it is host-specific text, not data.
 *
 * Nothing is validated here. `encodeError` runs `assertJson` over the result,
 * so a field holding a function, a capability, a handle, a cycle, or a symbol
 * key produces `ErrorCodecError` naming the exact path.
 */
function derivedErrorPayload(error: Error): JsonValue {
  // A null prototype keeps an own `__proto__` field as data. Into `{}` the same
  // assignment would go through the setter `Object.prototype` defines for that
  // name, and the field would be dropped from the wire with no diagnostic —
  // the opposite of what this codec promises above. `assertJson` and
  // `stringifyJson` both accept a null-prototype object, and the payload is
  // wire data rather than a value handed back to a caller, so nothing here
  // needs the ordinary prototype. Plain assignment is safe below for the same
  // reason: a null-prototype object inherits no setter to trip.
  const payload: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  payload.message = error.message;
  for (const key of Object.keys(error)) {
    if (key === "message" || key === "stack") continue;
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) continue;
    payload[key] = descriptor.value as JsonValue;
  }
  return payload;
}

/**
 * Rebuild an instance from a derived payload without running the constructor.
 *
 * The constructor's parameter list is not part of the wire contract — an author
 * may spell `constructor(readonly path: string, readonly reason: string)` or
 * take an options object — so calling it would make transport depend on a
 * signature the payload does not carry. `Object.create(type.prototype)` is what
 * keeps `instanceof`, the prototype identity `decodeError` re-checks, and every
 * inherited method intact while depending on nothing but the class.
 */
function derivedErrorInstance(type: ErrorConstructor, payload: JsonValue): Error {
  const record = parseRecord(payload, "$.payload");
  if (typeof record.message !== "string") throw new ErrorCodecError("$.payload.message must be a string");
  const decoded = Object.create(type.prototype) as Error;
  Object.defineProperty(decoded, "message", {
    value: record.message, writable: true, enumerable: false, configurable: true,
  });
  for (const key of Object.keys(record)) {
    if (key === "message") continue;
    Object.defineProperty(decoded, key, {
      value: record[key], writable: true, enumerable: true, configurable: true,
    });
  }
  // A decoded error crossed a realm boundary, so it has no local call site to
  // report. `stack` stays a string, which is what ordinary Error behavior gives
  // a reader, rather than becoming `undefined` only for decoded values.
  Object.defineProperty(decoded, "stack", {
    value: `${decoded.name}: ${record.message}`, writable: true, enumerable: false, configurable: true,
  });
  return decoded;
}

export function registerErrorCodec<E extends Error>(
  type: ErrorConstructor<E>,
  id: string,
  codec: ErrorPayloadCodec<E>,
): ErrorConstructor<E> {
  registerErrorType(type, id);
  const registration = registrationsByType.get(type) as ErrorRegistration<E>;
  if (registration.codec && registration.codec !== codec && !registration.derivedCodec) {
    throw new TypeError(`Error codec for ${id} is already registered`);
  }
  if (typeof codec?.encode !== "function" || typeof codec.decode !== "function") {
    throw new TypeError(`Error codec for ${id} must define encode and decode`);
  }
  // Snapshot callbacks so later mutation of a registration object cannot
  // silently change a stable transport identity.
  registration.codec = Object.freeze({ encode: codec.encode, decode: codec.decode });
  registration.derivedCodec = false;
  return type;
}

function registrationForError(error: Error): ErrorRegistration<any> | undefined {
  try {
    const prototype = Object.getPrototypeOf(error) as object | null;
    return prototype === null ? undefined : registrationsByPrototype.get(prototype);
  } catch {
    return undefined;
  }
}

export function errorIdentity(error: unknown): string | undefined {
  return isLocalError(error) ? registrationForError(error)?.id : undefined;
}

export function errorIs<E extends Error>(error: unknown, type: ErrorConstructor<E>): error is E {
  // The constructor is a compiler-resolved nominal key. It need not be in the
  // transport registry: imported TypeScript @throws classes are valid local
  // identities even when they have no Smithers wire codec.
  if (!isLocalError(error) || !isErrorConstructor(type)) return false;
  return nativeInstanceOf(error, type);
}

/**
 * Narrows to the union of the listed constructors' instance types. Narrowing is
 * only as precise as the classes are nominal; see {@link NominalError}.
 */
export function errorMatches<const Types extends readonly ErrorConstructor[]>(
  error: unknown,
  ...types: Types
): error is ErrorInstance<Types[number]> {
  return types.some((type) => errorIs(error, type));
}

export type ErrorCase<R> = readonly [ErrorConstructor, (error: any) => R];

export function errorCases<const Cases extends readonly ErrorCase<unknown>[]>(...cases: Cases): Cases {
  const seen = new Set<ErrorConstructor>();
  for (const entry of cases) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "function" || typeof entry[1] !== "function") {
      panic("invalid compiler-emitted Error match case");
    }
    if (!isErrorConstructor(entry[0])) panic("Error match case is not an Error constructor");
    if (seen.has(entry[0])) panic("duplicate Error match case");
    seen.add(entry[0]);
  }
  return Object.freeze(cases.map((entry) => Object.freeze([...entry]) as unknown as ErrorCase<unknown>)) as unknown as Cases;
}

export function matchError<R>(error: Error, cases: readonly ErrorCase<R>[]): R {
  for (const [type, handler] of cases) {
    if (errorIs(error, type)) return handler(error);
  }
  panic(`non-exhaustive Error match for ${errorIdentity(error) ?? "unregistered Error"}`);
}

export function matchErrorPartial<R, F>(
  error: Error,
  cases: readonly ErrorCase<R>[],
  fallback: (error: Error) => F,
): R | F {
  for (const [type, handler] of cases) {
    if (errorIs(error, type)) return handler(error);
  }
  return fallback(error);
}

export function rootCause(error: Error): unknown {
  let current: unknown = error;
  const seen = new Set<object>();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, "cause");
    if (!descriptor || !("value" in descriptor) || descriptor.value === undefined) return current;
    current = descriptor.value;
  }
  return current;
}

declare global {
  interface Error {
    is<E extends Error>(type: ErrorConstructor<E>): this is E;
    matches<const Types extends readonly ErrorConstructor[]>(...types: Types): this is ErrorInstance<Types[number]>;
    match<R>(cases: readonly ErrorCase<R>[]): R;
    matchPartial<R, F>(cases: readonly ErrorCase<R>[], fallback: (error: Error) => F): R | F;
    rootCause(): unknown;
  }
}

const errorPrototypeMethods = {
  is(this: Error, type: ErrorConstructor): boolean { return errorIs(this, type); },
  matches(this: Error, ...types: readonly ErrorConstructor[]): boolean { return errorMatches(this, ...types); },
  match<R>(this: Error, cases: readonly ErrorCase<R>[]): R { return matchError(this, cases); },
  matchPartial<R, F>(this: Error, cases: readonly ErrorCase<R>[], fallback: (error: Error) => F): R | F {
    return matchErrorPartial(this, cases, fallback);
  },
  rootCause(this: Error): unknown { return rootCause(this); },
} as const;

for (const [name, method] of Object.entries(errorPrototypeMethods)) {
  const existing = Object.getOwnPropertyDescriptor(Error.prototype, name);
  if (existing === undefined) {
    Object.defineProperty(Error.prototype, name, {
      value: method,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  } else if (existing.value !== method) {
    throw new TypeError(`Error.prototype.${name} is already installed by an incompatible runtime`);
  }
}

const MAX_WIRE_BYTES = 1_048_576;
const MAX_JSON_DEPTH = 64;

function assertJson(value: unknown, path = "$", depth = 0, seen = new Set<object>()): asserts value is JsonValue {
  if (depth > MAX_JSON_DEPTH) throw new ErrorCodecError(`${path} exceeds the codec depth limit`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ErrorCodecError(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object") throw new ErrorCodecError(`${path} is not JSON data`);
  if (seen.has(value)) throw new ErrorCodecError(`${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new ErrorCodecError(`${path}[${index}] is a sparse array hole`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new ErrorCodecError(`${path}[${index}] is not an enumerable data property`);
        }
        assertJson(descriptor.value, `${path}[${index}]`, depth + 1, seen);
      }
      const extras = Reflect.ownKeys(value).filter((key) => key !== "length" && !(typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)));
      if (extras.length > 0) throw new ErrorCodecError(`${path} has non-JSON array properties`);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ErrorCodecError(`${path} is not a plain JSON object`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new ErrorCodecError(`${path} has a symbol key`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new ErrorCodecError(`${path}.${key} is not an enumerable data property`);
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
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) throw new ErrorCodecError(`$.payload[${index}] changed during encoding`);
      items.push(stringifyJson(descriptor.value as JsonValue));
    }
    return `[${items.join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new ErrorCodecError(`$.payload.${key} changed during encoding`);
    return `${JSON.stringify(key)}:${stringifyJson(descriptor.value as JsonValue)}`;
  }).join(",")}}`;
}

function parseRecord(value: JsonValue, path: string): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ErrorCodecError(`${path} must be an object`);
  }
  return value;
}

function requireExactKeys(value: Record<string, JsonValue>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ErrorCodecError(`${path} has unexpected fields`);
  }
}

export function encodeError(error: Error): string {
  if (!isLocalError(error)) throw new ErrorCodecError("only local Error instances can be encoded");
  const registration = registrationForError(error);
  if (!registration?.codec) throw new ErrorCodecError("Error has no registered transport codec");
  let payload: JsonValue;
  try {
    payload = registration.codec.encode(error);
  } catch (cause) {
    throw new ErrorCodecError(`Error codec ${registration.id} failed to encode`, { cause });
  }
  try {
    assertJson(payload, "$.payload");
  } catch (cause) {
    if (cause instanceof ErrorCodecError) throw cause;
    throw new ErrorCodecError(`Error codec ${registration.id} returned unsafe data`, { cause });
  }
  const wire = `{"version":1,"identity":${JSON.stringify(registration.id)},"payload":${stringifyJson(payload)}}`;
  if (Buffer.byteLength(wire, "utf8") > MAX_WIRE_BYTES) throw new ErrorCodecError("encoded Error exceeds the wire limit");
  return wire;
}

export function decodeError(wire: string): Error {
  if (typeof wire !== "string") throw new ErrorCodecError("encoded Error must be a string");
  if (Buffer.byteLength(wire, "utf8") > MAX_WIRE_BYTES) throw new ErrorCodecError("encoded Error exceeds the wire limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(wire);
  } catch (cause) {
    throw new ErrorCodecError("encoded Error is not valid JSON", { cause });
  }
  assertJson(parsed);
  const envelope = parseRecord(parsed, "$" );
  requireExactKeys(envelope, ["version", "identity", "payload"], "$");
  if (envelope.version !== 1 || typeof envelope.identity !== "string") {
    throw new ErrorCodecError("encoded Error has an unsupported envelope");
  }
  const canonicalWire = `{"version":1,"identity":${JSON.stringify(envelope.identity)},"payload":${stringifyJson(envelope.payload)}}`;
  if (wire !== canonicalWire) throw new ErrorCodecError("encoded Error is not canonical JSON");
  const registration = registrationsById.get(envelope.identity);
  if (!registration?.codec) throw new ErrorCodecError(`unknown Error identity ${envelope.identity}`);
  let decoded: Error;
  try {
    decoded = registration.codec.decode(envelope.payload);
  } catch (cause) {
    throw new ErrorCodecError(`Error codec ${registration.id} failed to decode`, { cause });
  }
  if (
    !isLocalError(decoded) ||
    !nativeInstanceOf(decoded, registration.type) ||
    Object.getPrototypeOf(decoded) !== registration.type.prototype
  ) {
    throw new ErrorCodecError(`Error codec ${registration.id} returned the wrong Error type`);
  }
  return decoded;
}

function messagePayload(error: Error): JsonValue {
  return { message: error.message };
}

function decodeMessage(payload: JsonValue): string {
  const record = parseRecord(payload, "$.payload");
  requireExactKeys(record, ["message"], "$.payload");
  if (typeof record.message !== "string") throw new ErrorCodecError("$.payload.message must be a string");
  return record.message;
}

const builtins: Array<readonly [ErrorConstructor, string]> = [
  [Error, "javascript:Error@1"],
  [EvalError, "javascript:EvalError@1"],
  [RangeError, "javascript:RangeError@1"],
  [ReferenceError, "javascript:ReferenceError@1"],
  [SyntaxError, "javascript:SyntaxError@1"],
  [TypeError, "javascript:TypeError@1"],
  [URIError, "javascript:URIError@1"],
];
for (const [type, id] of builtins) {
  registerErrorCodec(type, id, {
    encode: messagePayload,
    decode: (payload) => new (type as new (message?: string) => Error)(decodeMessage(payload)),
  });
}

registerErrorCodec(Panic, "smithers:Panic@1", {
  encode: (error) => ({ message: error.message }),
  decode: (payload) => new Panic(decodeMessage(payload)),
});
registerErrorCodec(ErrorCodecError, "smithers:ErrorCodecError@1", {
  encode: messagePayload,
  decode: (payload) => new ErrorCodecError(decodeMessage(payload)),
});
registerErrorCodec(UnhandledException, "smithers:UnhandledException@1", {
  encode: (error) => ({ message: error.message }),
  decode: (payload) => new UnhandledException(decodeMessage(payload)),
});

/** Trusted lowering helper for a foreign `@throws T` contract. */
export function __vsValidateForeignError<E extends Error>(cause: unknown, type: ErrorConstructor<E>): E | Panic {
  if (isPanic(cause)) return cause;
  if (errorIs(cause, type)) return cause;
  return makePanic(isLocalError(cause) ? cause : new UnhandledException(cause));
}

export { errorCases as __vsErrorCases };

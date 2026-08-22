/** @module @throws {never} */
/** Provisional, bounded JSON handling for ordinary values. */
import {
  RuntimeValues,
  registerErrorCodec,
  type JsonValue as RuntimeJsonValue,
  type NominalError,
} from "../runtime/index.ts";
import type { Result } from "../runtime/result.ts";

const { failure, success } = RuntimeValues;

export type JsonValue = RuntimeJsonValue;
export type JsonPathSegment = string | number;

/** Kept identical to the durable canonicalizer's structural work budget. */
export const MAX_JSON_DEPTH = 256;
export const MAX_JSON_NODES = 100_000;
export const MAX_JSON_BYTES = 8 * 1024 * 1024;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function checkedPath(path: readonly JsonPathSegment[]): readonly JsonPathSegment[] {
  if (!Array.isArray(path)) throw new TypeError("JSON error path must be an array");
  return Object.freeze(path.map((segment) => {
    if (typeof segment === "string") return segment;
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) return segment;
    throw new TypeError("JSON error paths contain only strings and array indices");
  }));
}

function renderPath(path: readonly JsonPathSegment[]): string {
  let output = "$";
  for (const segment of path) {
    output += typeof segment === "number"
      ? `[${segment}]`
      : IDENTIFIER.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }
  return output;
}

abstract class JsonOperationError extends Error {
  readonly path: readonly JsonPathSegment[];
  readonly pointer: string;
  readonly reason: string;

  protected constructor(name: string, path: readonly JsonPathSegment[], reason: string) {
    const checked = checkedPath(path);
    const pointer = renderPath(checked);
    super(`${pointer} ${reason}`);
    this.name = name;
    this.path = checked;
    this.pointer = pointer;
    this.reason = reason;
  }
}

export class JsonParseError extends JsonOperationError {
  constructor(path: readonly JsonPathSegment[], reason: string) {
    super("JsonParseError", path, reason);
  }
}
export interface JsonParseError extends NominalError<"vibelang:JsonParseError@1"> {}

export class JsonEncodeError extends JsonOperationError {
  constructor(path: readonly JsonPathSegment[], reason: string) {
    super("JsonEncodeError", path, reason);
  }
}
export interface JsonEncodeError extends NominalError<"vibelang:JsonEncodeError@1"> {}

function errorPayload(error: JsonOperationError): JsonValue {
  return { path: [...error.path], reason: error.reason };
}

function decodePayload(payload: JsonValue, Type: new (path: readonly JsonPathSegment[], reason: string) => JsonOperationError): JsonOperationError {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("JSON operation error payload must be an object");
  }
  const keys = Object.keys(payload).sort();
  if (keys.length !== 2 || keys[0] !== "path" || keys[1] !== "reason") {
    throw new TypeError("JSON operation error payload has unexpected fields");
  }
  if (!Array.isArray(payload.path) || typeof payload.reason !== "string") {
    throw new TypeError("JSON operation error payload requires a path array and reason string");
  }
  return new Type(payload.path as JsonPathSegment[], payload.reason);
}

registerErrorCodec(JsonParseError, "vibelang:JsonParseError@1", {
  encode: errorPayload,
  decode: (payload) => decodePayload(payload, JsonParseError) as JsonParseError,
});

registerErrorCodec(JsonEncodeError, "vibelang:JsonEncodeError@1", {
  encode: errorPayload,
  decode: (payload) => decodePayload(payload, JsonEncodeError) as JsonEncodeError,
});

class JsonIssue extends Error {
  constructor(readonly path: readonly JsonPathSegment[], readonly reason: string) {
    super(reason);
  }
}

interface Budget {
  nodes: number;
}

function issue(path: readonly JsonPathSegment[], reason: string): never {
  throw new JsonIssue(path, reason);
}

function unicodeScalar(text: string, path: readonly JsonPathSegment[], key = false): string {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) issue(path, `${key ? "object key has" : "contains"} an unpaired high surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      issue(path, `${key ? "object key has" : "contains"} an unpaired low surrogate`);
    }
  }
  return text;
}

function normalize(
  value: unknown,
  path: readonly JsonPathSegment[],
  depth: number,
  budget: Budget,
  seen: Set<object>,
  sortKeys: boolean,
): JsonValue {
  if (depth > MAX_JSON_DEPTH) issue(path, "exceeds the JSON nesting limit");
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES) issue(path, "exceeds the JSON node limit");

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return unicodeScalar(value, path);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issue(path, "contains a non-finite number");
    // Durable JSON rejects -0 instead of silently changing its identity to 0.
    if (Object.is(value, -0)) issue(path, "contains negative zero");
    return value;
  }
  if (typeof value !== "object") issue(path, `contains a non-JSON ${typeof value} value`);
  if (seen.has(value)) issue(path, "contains a cycle");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) issue(path, "is not a plain JSON array");
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length > MAX_JSON_NODES + 1) issue(path, "exceeds the JSON own-field limit");
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
          issue(path, `has unexpected array property ${String(key)}`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          issue([...path, Number(key)], "is an accessor or hidden property");
        }
      }
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) issue([...path, index], "is a sparse array hole");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) issue([...path, index], "changed during JSON encoding");
        output.push(normalize(descriptor.value, [...path, index], depth + 1, budget, seen, sortKeys));
      }
      return Object.freeze(output) as JsonValue;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) issue(path, "is not a plain JSON object");
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > MAX_JSON_NODES) issue(path, "exceeds the JSON own-field limit");
    for (const key of ownKeys) {
      if (typeof key !== "string") issue(path, "has a symbol-keyed property");
      unicodeScalar(key, [...path, key], true);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        issue([...path, key], "is an accessor or hidden property");
      }
    }
    const output = Object.create(null) as Record<string, JsonValue>;
    const keys = Object.keys(value);
    if (sortKeys) keys.sort();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) issue([...path, key], "changed during JSON encoding");
      Object.defineProperty(output, key, {
        value: normalize(descriptor.value, [...path, key], depth + 1, budget, seen, sortKeys),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output) as JsonValue;
  } finally {
    seen.delete(value);
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function canonicalText(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalText(value[key]!)}`).join(",")}}`;
}

function encodeResult(value: unknown, canonicalEncoding: boolean): Result<string, JsonEncodeError> {
  try {
    const normalized = normalize(value, [], 0, { nodes: 0 }, new Set(), canonicalEncoding);
    const encoded = canonicalEncoding ? canonicalText(normalized) : JSON.stringify(normalized);
    if (byteLength(encoded) > MAX_JSON_BYTES) return failure(new JsonEncodeError([], "exceeds the JSON byte limit"));
    return success(encoded);
  } catch (cause) {
    if (cause instanceof JsonIssue) return failure(new JsonEncodeError(cause.path, cause.reason));
    return failure(new JsonEncodeError([], "could not be inspected safely"));
  }
}

function parse(text: string): Result<JsonValue, JsonParseError> {
  if (typeof text !== "string") return failure(new JsonParseError([], "expected JSON text"));
  if (byteLength(text) > MAX_JSON_BYTES) return failure(new JsonParseError([], "exceeds the JSON byte limit"));
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return failure(new JsonParseError([], "contains invalid JSON syntax"));
  }
  try {
    return success(normalize(value, [], 0, { nodes: 0 }, new Set(), false));
  } catch (cause) {
    if (cause instanceof JsonIssue) return failure(new JsonParseError(cause.path, cause.reason));
    return failure(new JsonParseError([], "could not be inspected safely"));
  }
}

function stringify(value: unknown): Result<string, JsonEncodeError> {
  return encodeResult(value, false);
}

function canonical(value: unknown): Result<Uint8Array, JsonEncodeError> {
  return encodeResult(value, true).map((text) => new TextEncoder().encode(text));
}

export const Json = Object.freeze({
  parse,
  stringify,
  canonical,
  MAX_DEPTH: MAX_JSON_DEPTH,
  MAX_NODES: MAX_JSON_NODES,
  MAX_BYTES: MAX_JSON_BYTES,
});

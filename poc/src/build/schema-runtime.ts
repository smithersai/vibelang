/** @module @throws {never} */
/**
 * Runtime half of the compiler-owned `comptime(Schema.derive<T>())` intrinsic.
 *
 * The comptime frontend derives a bounded structural descriptor from the
 * TypeScript checker and lowers the call site to `__vsSchema<T>({ ...literal })`
 * against this module. Nothing here inspects types: it only interprets the
 * descriptor the compiler already proved, so the emitted program carries no
 * schema declaration a developer could drift from the type.
 */
import { __vsResultFailure, __vsResultSuccess, registerErrorCodec } from "../runtime/index.ts";
import type { JsonValue, Result } from "../runtime/index.ts";

export type SchemaPathSegment = string | number;

export interface SchemaProperty {
  readonly name: string;
  readonly optional: boolean;
  readonly value: SchemaDescriptor;
}

/**
 * Canonical structural descriptor. This is deliberately the whole reification
 * grammar the POC supports; anything a type can express beyond it fails closed
 * in the compiler rather than degrading to an unchecked cast at runtime.
 */
export type SchemaDescriptor =
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "null" }
  | { readonly kind: "literal"; readonly value: string | number | boolean }
  | { readonly kind: "array"; readonly element: SchemaDescriptor }
  | { readonly kind: "tuple"; readonly elements: readonly SchemaDescriptor[] }
  | { readonly kind: "union"; readonly variants: readonly SchemaDescriptor[] }
  | { readonly kind: "object"; readonly properties: readonly SchemaProperty[] };

export interface DerivedSchema<T> {
  readonly descriptor: SchemaDescriptor;
  readonly parse: (value: unknown) => Result<T, ValidationError>;
}

const MAX_DESCRIPTOR_DEPTH = 32;
const MAX_DESCRIPTOR_NODES = 8192;

export class ValidationError extends Error {
  /** Structured location of the first rejected value, from the parse root. */
  readonly path: readonly SchemaPathSegment[];
  /** Rendered form of `path`, for example `$.contacts[0].email`. */
  readonly pointer: string;
  readonly reason: string;

  constructor(path: readonly SchemaPathSegment[], reason: string) {
    const segments = Object.freeze(assertPath(path));
    const pointer = renderPointer(segments);
    super(`${pointer} ${reason}`);
    this.name = "ValidationError";
    this.path = segments;
    this.pointer = pointer;
    this.reason = reason;
  }
}

function assertPath(path: readonly SchemaPathSegment[]): SchemaPathSegment[] {
  if (!Array.isArray(path)) throw new TypeError("ValidationError path must be an array");
  return path.map((segment) => {
    if (typeof segment === "string") return segment;
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) return segment;
    throw new TypeError("ValidationError path segments must be strings or array indices");
  });
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function renderPointer(path: readonly SchemaPathSegment[]): string {
  let pointer = "$";
  for (const segment of path) {
    pointer += typeof segment === "number"
      ? `[${segment}]`
      : IDENTIFIER.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }
  return pointer;
}

registerErrorCodec(ValidationError, "vibelang:ValidationError@1", {
  encode: (error): JsonValue => ({
    path: [...error.path],
    reason: error.reason,
  }),
  decode: (payload): ValidationError => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("ValidationError payload must be an object");
    }
    const path = payload.path;
    const reason = payload.reason;
    if (!Array.isArray(path) || typeof reason !== "string") {
      throw new TypeError("ValidationError payload requires a path array and reason string");
    }
    return new ValidationError(assertPath(path as SchemaPathSegment[]), reason);
  },
});

/**
 * Compiler lowering hook. The descriptor literal is compiler-generated, but this
 * is a public export, so it is re-validated before it can drive a parser.
 */
export function __vsSchema<T>(descriptor: SchemaDescriptor): DerivedSchema<T> {
  const validated = freezeDescriptor(assertSchemaDescriptor(descriptor, "$descriptor", 0, { nodes: 0 }));
  const parse = (value: unknown): Result<T, ValidationError> => {
    try {
      return __vsResultSuccess(decode(validated, value, []) as T);
    } catch (error) {
      if (error instanceof ValidationError) return __vsResultFailure(error);
      throw error;
    }
  };
  return Object.freeze({ descriptor: validated, parse });
}

/** Author-facing alias for the compiler lowering hook. */
export const derivedSchema = __vsSchema;

interface DescriptorBudget {
  nodes: number;
}

export function assertSchemaDescriptor(
  descriptor: unknown,
  path = "$descriptor",
  depth = 0,
  budget: DescriptorBudget = { nodes: 0 },
): SchemaDescriptor {
  if (depth > MAX_DESCRIPTOR_DEPTH) throw new TypeError(`${path} exceeds the schema descriptor depth limit`);
  if (++budget.nodes > MAX_DESCRIPTOR_NODES) throw new TypeError(`${path} exceeds the schema descriptor node limit`);
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new TypeError(`${path} must be a schema descriptor object`);
  }
  const record = descriptor as Record<string, unknown>;
  switch (record.kind) {
    case "string":
    case "number":
    case "boolean":
    case "null":
      return descriptor as SchemaDescriptor;
    case "literal": {
      const value = record.value;
      if (typeof value === "string" || typeof value === "boolean") return descriptor as SchemaDescriptor;
      if (typeof value === "number" && Number.isFinite(value)) return descriptor as SchemaDescriptor;
      throw new TypeError(`${path}.value must be a finite scalar literal`);
    }
    case "array":
      assertSchemaDescriptor(record.element, `${path}.element`, depth + 1, budget);
      return descriptor as SchemaDescriptor;
    case "tuple": {
      if (!Array.isArray(record.elements)) throw new TypeError(`${path}.elements must be an array`);
      record.elements.forEach((element, index) =>
        assertSchemaDescriptor(element, `${path}.elements[${index}]`, depth + 1, budget));
      return descriptor as SchemaDescriptor;
    }
    case "union": {
      if (!Array.isArray(record.variants) || record.variants.length < 2) {
        throw new TypeError(`${path}.variants must contain at least two descriptors`);
      }
      record.variants.forEach((variant, index) =>
        assertSchemaDescriptor(variant, `${path}.variants[${index}]`, depth + 1, budget));
      return descriptor as SchemaDescriptor;
    }
    case "object": {
      if (!Array.isArray(record.properties)) throw new TypeError(`${path}.properties must be an array`);
      const seen = new Set<string>();
      record.properties.forEach((property, index) => {
        const where = `${path}.properties[${index}]`;
        if (property === null || typeof property !== "object" || Array.isArray(property)) {
          throw new TypeError(`${where} must be a property descriptor`);
        }
        const entry = property as Record<string, unknown>;
        if (typeof entry.name !== "string") throw new TypeError(`${where}.name must be a string`);
        if (typeof entry.optional !== "boolean") throw new TypeError(`${where}.optional must be a boolean`);
        if (seen.has(entry.name)) throw new TypeError(`${where}.name is a duplicate property`);
        seen.add(entry.name);
        assertSchemaDescriptor(entry.value, `${where}.value`, depth + 1, budget);
      });
      return descriptor as SchemaDescriptor;
    }
    default:
      throw new TypeError(`${path}.kind ${JSON.stringify(record.kind)} is not a schema descriptor kind`);
  }
}

function freezeDescriptor(descriptor: SchemaDescriptor): SchemaDescriptor {
  switch (descriptor.kind) {
    case "array":
      freezeDescriptor(descriptor.element);
      break;
    case "tuple":
      descriptor.elements.forEach(freezeDescriptor);
      Object.freeze(descriptor.elements);
      break;
    case "union":
      descriptor.variants.forEach(freezeDescriptor);
      Object.freeze(descriptor.variants);
      break;
    case "object":
      for (const property of descriptor.properties) {
        freezeDescriptor(property.value);
        Object.freeze(property);
      }
      Object.freeze(descriptor.properties);
      break;
  }
  return Object.freeze(descriptor);
}

/** Human-readable expectation used in failure reasons. */
export function describeSchema(descriptor: SchemaDescriptor): string {
  switch (descriptor.kind) {
    case "literal": return JSON.stringify(descriptor.value);
    case "array": return `${describeSchema(descriptor.element)}[]`;
    case "tuple": return `[${descriptor.elements.map(describeSchema).join(", ")}]`;
    case "union": return descriptor.variants.map(describeSchema).join(" | ");
    case "object": return "an object";
    default: return descriptor.kind;
  }
}

function fail(path: readonly SchemaPathSegment[], reason: string): never {
  throw new ValidationError(path, reason);
}

function ownValue(host: object, key: string | number, path: readonly SchemaPathSegment[]): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(host, String(key));
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    fail([...path, key], "is not an enumerable data property");
  }
  return descriptor.value;
}

function assertPlainArray(input: readonly unknown[], path: readonly SchemaPathSegment[]): void {
  if (Object.getPrototypeOf(input) !== Array.prototype) fail(path, "expected a plain array");
  for (const key of Reflect.ownKeys(input)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length) {
      fail(path, "expected a plain array without extra properties");
    }
  }
}

function decode(
  descriptor: SchemaDescriptor,
  input: unknown,
  path: readonly SchemaPathSegment[],
): unknown {
  switch (descriptor.kind) {
    case "string":
      if (typeof input === "string") return input;
      break;
    case "number":
      if (typeof input === "number" && Number.isFinite(input)) return input;
      break;
    case "boolean":
      if (typeof input === "boolean") return input;
      break;
    case "null":
      if (input === null) return null;
      break;
    case "literal":
      if (input === descriptor.value) return input;
      break;
    case "array": {
      if (!Array.isArray(input)) break;
      assertPlainArray(input, path);
      const output: unknown[] = [];
      for (let index = 0; index < input.length; index++) {
        output.push(decode(descriptor.element, ownValue(input, index, path), [...path, index]));
      }
      return Object.freeze(output);
    }
    case "tuple": {
      if (!Array.isArray(input)) break;
      assertPlainArray(input, path);
      if (input.length !== descriptor.elements.length) {
        fail(path, `expected a ${descriptor.elements.length}-element tuple but received ${input.length}`);
      }
      const output = descriptor.elements.map((element, index) =>
        decode(element, ownValue(input, index, path), [...path, index]));
      return Object.freeze(output);
    }
    case "union": {
      for (const variant of descriptor.variants) {
        try {
          return decode(variant, input, path);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
        }
      }
      // A union reports at its own path. Attributing the miss to whichever
      // variant happened to fail last would name an arbitrary alternative.
      break;
    }
    case "object": {
      if (typeof input !== "object" || input === null || Array.isArray(input)) break;
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) break;
      const declared = new Set(descriptor.properties.map((property) => property.name));
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string") fail(path, "expected an object without symbol-keyed properties");
        if (!declared.has(key)) fail([...path, key], "is not declared by the derived type");
      }
      const output: Record<string, unknown> = {};
      for (const property of descriptor.properties) {
        if (!Object.hasOwn(input, property.name)) {
          if (property.optional) continue;
          fail([...path, property.name], `is required and expected ${describeSchema(property.value)}`);
        }
        Object.defineProperty(output, property.name, {
          value: decode(property.value, ownValue(input, property.name, path), [...path, property.name]),
          enumerable: true,
          writable: false,
          configurable: false,
        });
      }
      return Object.freeze(output);
    }
  }
  fail(path, `expected ${describeSchema(descriptor)}`);
}

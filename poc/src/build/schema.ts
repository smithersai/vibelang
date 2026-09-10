import { getNativeCompiler } from "../compiler/native.ts";
import { VibeLangFailure } from "../runtime/failure.ts";

export type SchemaNode =
  | { kind: "string" | "number" | "boolean" | "null" | "unknown" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "array"; element: SchemaNode }
  | { kind: "tuple"; elements: SchemaNode[] }
  | { kind: "union"; variants: SchemaNode[] }
  | { kind: "object"; properties: Record<string, { optional: boolean; schema: SchemaNode }> };

export class ValidationFailure extends VibeLangFailure {
  declare readonly _tag: "ValidationFailure";
  constructor(readonly path: string, readonly expected: string) {
    super("ValidationFailure");
    this.message = `${path} expected ${expected}`;
  }
}

/**
 * Small declaration-to-validator-IR helper, with native syntax and binding.
 * The checked language intrinsic is a separate native schema pass. Neither
 * path invokes authored code merely to derive a schema.
 */
export function deriveSchema(source: string, typeName: string): SchemaNode {
  const result = getNativeCompiler().syntaxSchema(source, typeName);
  if (!result.ok) {
    if (result.parseError) throw new SyntaxError(result.message);
    throw new Error(result.message);
  }
  // The native binding validates this bounded data grammar before returning.
  // JSON decoding preserves exact UTF-16 keys/literals, including lone escapes.
  return freezeSchema(JSON.parse(result.schemaJson) as SchemaNode);
}

function freezeSchema(schema: SchemaNode): SchemaNode {
  switch (schema.kind) {
    case "array": freezeSchema(schema.element); break;
    case "tuple": schema.elements.forEach(freezeSchema); Object.freeze(schema.elements); break;
    case "union": schema.variants.forEach(freezeSchema); Object.freeze(schema.variants); break;
    case "object":
      Object.setPrototypeOf(schema.properties, null);
      for (const property of Object.values(schema.properties)) {
        freezeSchema(property.schema);
        Object.freeze(property);
      }
      Object.freeze(schema.properties);
      break;
  }
  return Object.freeze(schema);
}

export function parseWithSchema<T>(schema: SchemaNode, input: unknown): T {
  return decode(schema, input, "$input") as T;
}

function decode(schema: SchemaNode, input: unknown, path: string): unknown {
  switch (schema.kind) {
    case "unknown": return input;
    case "null": if (input === null) return input; break;
    case "string": if (typeof input === "string") return input; break;
    case "number": if (typeof input === "number" && Number.isFinite(input)) return input; break;
    case "boolean": if (typeof input === "boolean") return input; break;
    case "literal": if (input === schema.value) return input; break;
    case "array":
      if (Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype) {
        assertPlainArray(input, path);
        const output: unknown[] = [];
        for (let index = 0; index < input.length; index++) {
          output.push(decode(schema.element, arrayElement(input, index, path, schema.element), `${path}[${index}]`));
        }
        return output;
      }
      break;
    case "tuple":
      if (Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype && input.length === schema.elements.length) {
        assertPlainArray(input, path);
        return schema.elements.map((element, index) => {
          return decode(element, arrayElement(input, index, path, element), `${path}[${index}]`);
        });
      }
      break;
    case "union": {
      for (const variant of schema.variants) {
        try { return decode(variant, input, path); } catch (error) {
          if (!(error instanceof ValidationFailure)) throw error;
        }
      }
      break;
    }
    case "object":
      if (typeof input === "object" && input !== null && !Array.isArray(input)) {
        const object = input as Record<string, unknown>;
        const prototype = Object.getPrototypeOf(object);
        if (prototype !== Object.prototype && prototype !== null) break;
        const output = Object.create(null) as Record<string, unknown>;
        for (const [key, property] of Object.entries(schema.properties)) {
          if (!Object.hasOwn(object, key)) {
            if (property.optional) continue;
            throw new ValidationFailure(`${path}.${key}`, describe(property.schema));
          }
          const descriptor = Object.getOwnPropertyDescriptor(object, key);
          if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
            throw new ValidationFailure(`${path}.${key}`, describe(property.schema));
          }
          output[key] = decode(property.schema, descriptor.value, `${path}.${key}`);
        }
        return output;
      }
      break;
  }
  throw new ValidationFailure(path, describe(schema));
}

function assertPlainArray(input: unknown[], path: string): void {
  for (const key of Reflect.ownKeys(input)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length) {
      throw new ValidationFailure(path, "plain array");
    }
  }
}

function arrayElement(input: unknown[], index: number, path: string, schema: SchemaNode): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, index);
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new ValidationFailure(`${path}[${index}]`, describe(schema));
  }
  return descriptor.value;
}

function describe(schema: SchemaNode): string {
  switch (schema.kind) {
    case "literal": return JSON.stringify(schema.value);
    case "array": return `Array<${describe(schema.element)}>`;
    case "tuple": return `[${schema.elements.map(describe).join(", ")}]`;
    case "union": return schema.variants.map(describe).join(" | ");
    case "object": return "object";
    default: return schema.kind;
  }
}

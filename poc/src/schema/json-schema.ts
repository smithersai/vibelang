/** @module @throws {JsonSchemaError} */
/** Provisional derivation of JSON Schema draft 2020-12 documents. */
import { registerErrorCodec, type NominalError } from "../runtime/index.ts";
import { denseArray } from "../data/array-shape.ts";
import type { JsonValue } from "./json.ts";
import {
  inspectSchema,
  type RuntimeSchemaDescriptor,
  type Schema,
  type SchemaInspection,
} from "./schema.ts";

export class JsonSchemaError extends Error {
  readonly schemaPath: readonly (string | number)[];
  readonly reason: string;

  constructor(schemaPath: readonly (string | number)[], reason: string) {
    if (!Array.isArray(schemaPath)) throw new TypeError("JsonSchemaError schemaPath must be an array");
    // `.map` skips a hole without calling the check below, so gate first.
    const checked = denseArray(schemaPath, () => {
      throw new TypeError("JsonSchemaError paths contain only strings and array indices");
    }).map((segment) => {
      if (typeof segment === "string") return segment;
      if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) return segment;
      throw new TypeError("JsonSchemaError paths contain only strings and array indices");
    });
    super(`Schema ${checked.length === 0 ? "$" : `$.${checked.join(".")}`} ${reason}`);
    this.name = "JsonSchemaError";
    this.schemaPath = Object.freeze(checked);
    this.reason = reason;
  }
}
export interface JsonSchemaError extends NominalError<"smithers:JsonSchemaError@1"> {}

registerErrorCodec(JsonSchemaError, "smithers:JsonSchemaError@1", {
  encode: (error) => ({ schemaPath: [...error.schemaPath], reason: error.reason }),
  decode: (payload) => {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("JsonSchemaError payload must be an object");
    }
    const keys = Object.keys(payload).sort();
    if (keys.length !== 2 || keys[0] !== "reason" || keys[1] !== "schemaPath") {
      throw new TypeError("JsonSchemaError payload has unexpected fields");
    }
    if (!Array.isArray(payload.schemaPath) || typeof payload.reason !== "string") {
      throw new TypeError("JsonSchemaError payload requires schemaPath and reason");
    }
    return new JsonSchemaError(payload.schemaPath as (string | number)[], payload.reason);
  },
});

interface NamedShape {
  count: number;
  readonly fingerprint: string;
  readonly schema: Schema<unknown>;
}

function descriptorFingerprint(descriptor: RuntimeSchemaDescriptor): string {
  switch (descriptor.kind) {
    case "string":
    case "number":
    case "boolean":
    case "null": return `(${descriptor.kind})`;
    case "literal": return `(literal:${JSON.stringify(descriptor.value)})`;
    case "array": return `(array:${descriptorFingerprint(descriptor.element)})`;
    case "tuple": return `(tuple:${descriptor.elements.map(descriptorFingerprint).join(",")})`;
    case "union": return `(union:${descriptor.variants.map(descriptorFingerprint).join(",")})`;
    case "record": return `(record:${descriptorFingerprint(descriptor.value)})`;
    case "object": return `(object:${descriptor.properties.map((property) =>
      `${JSON.stringify(property.name)}:${property.optional ? "?" : "!"}:${descriptorFingerprint(property.value)}`).join(",")})`;
    default: throw new JsonSchemaError([], "contains an unsupported descriptor node");
  }
}

function childrenOf(inspection: SchemaInspection): readonly Schema<unknown>[] {
  switch (inspection.shape.kind) {
    case "leaf": return [];
    case "array": return [inspection.shape.element];
    case "tuple": return inspection.shape.elements;
    case "union": return inspection.shape.variants;
    case "object": return inspection.shape.properties.map((property) => property.schema);
    case "record": return [inspection.shape.value];
  }
}

function collectNames(
  schema: Schema<unknown>,
  path: readonly (string | number)[],
  named: Map<string, NamedShape>,
): void {
  const inspection = inspectSchema(schema);
  if (inspection.refinements.length > 0) {
    throw new JsonSchemaError(path, "has an arbitrary refinement that JSON Schema cannot represent safely");
  }
  descriptorFingerprint(inspection.descriptor);
  if (inspection.name !== undefined) {
    const fingerprint = descriptorFingerprint(inspection.descriptor);
    const existing = named.get(inspection.name);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new JsonSchemaError(path, `reuses name ${JSON.stringify(inspection.name)} for a different shape`);
    }
    if (existing) existing.count += 1;
    else named.set(inspection.name, { count: 1, fingerprint, schema });
  }
  childrenOf(inspection).forEach((child, index) => collectNames(child, [...path, index], named));
}

function reference(name: string): JsonValue {
  return { $ref: `#/$defs/${name.replaceAll("~", "~0").replaceAll("/", "~1")}` };
}

function emit(
  schema: Schema<unknown>,
  named: ReadonlyMap<string, NamedShape>,
  bypassName?: string,
): JsonValue {
  const inspection = inspectSchema(schema);
  const name = inspection.name;
  if (name !== undefined && name !== bypassName && (named.get(name)?.count ?? 0) > 1) return reference(name);

  let emitted: Record<string, JsonValue>;
  switch (inspection.shape.kind) {
    case "leaf": {
      const descriptor = inspection.descriptor;
      switch (descriptor.kind) {
        case "string": emitted = { type: "string" }; break;
        case "number": emitted = { type: "number" }; break;
        case "boolean": emitted = { type: "boolean" }; break;
        case "null": emitted = { type: "null" }; break;
        case "literal": emitted = { const: descriptor.value }; break;
        default: throw new JsonSchemaError([], `cannot emit ${descriptor.kind} as a leaf`);
      }
      break;
    }
    case "array":
      emitted = { type: "array", items: emit(inspection.shape.element, named) };
      break;
    case "tuple":
      emitted = {
        type: "array",
        prefixItems: inspection.shape.elements.map((element) => emit(element, named)),
        items: false,
        minItems: inspection.shape.elements.length,
        maxItems: inspection.shape.elements.length,
      };
      break;
    case "union":
      emitted = { anyOf: inspection.shape.variants.map((variant) => emit(variant, named)) };
      break;
    case "object": {
      const properties: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      const required: string[] = [];
      for (const property of inspection.shape.properties) {
        properties[property.name] = emit(property.schema, named);
        if (!property.optional) required.push(property.name);
      }
      emitted = {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
      break;
    }
    case "record":
      emitted = { type: "object", additionalProperties: emit(inspection.shape.value, named) };
      break;
  }
  if (name !== undefined) emitted = { title: name, ...emitted };
  return emitted;
}

function deepFreeze(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value) as JsonValue;
  }
  for (const key of Object.keys(value)) deepFreeze(value[key]!);
  return Object.freeze(value);
}

function fromSchema<T>(schema: Schema<T>): JsonValue {
  const root = schema as Schema<unknown>;
  const named = new Map<string, NamedShape>();
  collectNames(root, [], named);
  const body = emit(root, named) as Record<string, JsonValue>;
  const document: Record<string, JsonValue> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...body,
  };
  const repeated = [...named.entries()].filter(([, shape]) => shape.count > 1)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (repeated.length > 0) {
    const definitions: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [name, shape] of repeated) definitions[name] = emit(shape.schema, named, name);
    document.$defs = definitions;
  }
  return deepFreeze(document);
}

export const JsonSchema = Object.freeze({ fromSchema });

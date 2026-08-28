import { describe, expect, test } from "bun:test";
import { decodeError, encodeError } from "../runtime/index.ts";
import { JsonSchema, JsonSchemaError } from "./json-schema.ts";
import { Schema } from "./schema.ts";

describe("JsonSchema.fromSchema", () => {
  test("emits draft 2020-12 structures for every runtime descriptor node", () => {
    const schema = Schema.struct({
      text: Schema.string,
      count: Schema.number,
      enabled: Schema.boolean,
      nothing: Schema.null,
      status: Schema.literal("ready"),
      tags: Schema.array(Schema.string),
      pair: Schema.tuple(Schema.number, Schema.boolean),
      choice: Schema.union(Schema.string, Schema.number),
      maybe: Schema.nullable(Schema.string),
      metadata: Schema.record(Schema.number),
      nickname: Schema.optional(Schema.string),
    });
    const document = JsonSchema.fromSchema(schema) as Record<string, unknown>;
    expect(document.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(document.type).toBe("object");
    expect(document.additionalProperties).toBe(false);
    expect(document.required).toEqual([
      "choice", "count", "enabled", "maybe", "metadata", "nothing", "pair", "status", "tags", "text",
    ]);

    const properties = document.properties as Record<string, Record<string, unknown>>;
    expect(properties.text).toEqual({ type: "string" });
    expect(properties.count).toEqual({ type: "number" });
    expect(properties.enabled).toEqual({ type: "boolean" });
    expect(properties.nothing).toEqual({ type: "null" });
    expect(properties.status).toEqual({ const: "ready" });
    expect(properties.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(properties.pair).toEqual({
      type: "array",
      prefixItems: [{ type: "number" }, { type: "boolean" }],
      items: false,
      minItems: 2,
      maxItems: 2,
    });
    expect(properties.choice).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(properties.maybe).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(properties.metadata).toEqual({ type: "object", additionalProperties: { type: "number" } });
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(properties)).toBe(true);
  });

  test("uses $defs and escaped $refs for repeated named shapes", () => {
    const entity = Schema.struct({ id: Schema.number, label: Schema.string }).describe("Entity/row~v1");
    const document = JsonSchema.fromSchema(Schema.struct({ primary: entity, secondary: entity })) as Record<string, any>;
    expect(document.properties.primary).toEqual({ $ref: "#/$defs/Entity~1row~0v1" });
    expect(document.properties.secondary).toEqual({ $ref: "#/$defs/Entity~1row~0v1" });
    expect(document.$defs["Entity/row~v1"]).toEqual({
      title: "Entity/row~v1",
      type: "object",
      properties: { id: { type: "number" }, label: { type: "string" } },
      required: ["id", "label"],
      additionalProperties: false,
    });
  });

  test("accepted values line up with emitted required and closed-object structure", () => {
    const schema = Schema.struct({ id: Schema.number, alias: Schema.optional(Schema.string) });
    const parsed = schema.parse({ id: 1 }).unwrap();
    const emitted = JsonSchema.fromSchema(schema) as Record<string, any>;
    expect(Object.keys(parsed)).toEqual(["id"]);
    expect(emitted.required).toEqual(["id"]);
    expect(emitted.properties.id).toEqual({ type: "number" });
    expect(emitted.properties.alias).toEqual({ type: "string" });
    expect(emitted.additionalProperties).toBe(false);
  });
});

describe("JsonSchema fail-closed behavior", () => {
  test("rejects arbitrary refinements instead of emitting a lying schema", () => {
    const refined = Schema.struct({ age: Schema.number.refine((age) => age >= 18, "adult") });
    expect(() => JsonSchema.fromSchema(refined)).toThrow(JsonSchemaError);
    try {
      JsonSchema.fromSchema(refined);
    } catch (error) {
      expect(error).toMatchObject({ schemaPath: [0], reason: "has an arbitrary refinement that JSON Schema cannot represent safely" });
    }
  });

  test("rejects one name reused for incompatible shapes", () => {
    const document = Schema.struct({
      left: Schema.struct({ value: Schema.string }).describe("Collision"),
      right: Schema.struct({ value: Schema.number }).describe("Collision"),
    });
    expect(() => JsonSchema.fromSchema(document)).toThrow("reuses name \"Collision\" for a different shape");
  });
});

describe("JsonSchemaError wire identity", () => {
  test("validates a schema path through its holes, not around them", () => {
    expect(() => new JsonSchemaError(new Array(1) as never, "boom")).toThrow(
      "JsonSchemaError paths contain only strings and array indices",
    );
    expect(() => new JsonSchemaError([undefined as never], "boom")).toThrow(
      "JsonSchemaError paths contain only strings and array indices",
    );
    expect(new JsonSchemaError(["properties", 2], "boom").schemaPath).toEqual(["properties", 2]);
  });

  test("round-trips through the nominal Error registry", () => {
    const original = new JsonSchemaError(["properties", 2], "unsupported node");
    const decoded = decodeError(encodeError(original));
    expect(decoded).toBeInstanceOf(JsonSchemaError);
    expect(decoded).toMatchObject({ schemaPath: ["properties", 2], reason: "unsupported node" });
  });
});

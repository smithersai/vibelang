import { describe, expect, test } from "bun:test";
import { ValidationError, __vsSchema } from "../build/schema-runtime.ts";
import { Equivalence } from "../data/equivalence.ts";
import { Hash } from "../data/hash.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { decodeError, encodeError } from "../runtime/index.ts";
import {
  OptionalSchemaValue,
  Schema,
  SchemaValue,
  type Schema as SchemaType,
} from "./schema.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

function validationError<T>(schema: SchemaType<T>, input: unknown): ValidationError {
  return schema.parse(input).match({ ok: () => { throw new Error("expected failure"); }, error: (error) => error });
}

describe("runtime Schema values", () => {
  test("carry the canonical build descriptor and reuse its parser exactly", () => {
    const schema = Schema.struct({
      active: Schema.boolean,
      age: Schema.number,
      nickname: Schema.optional(Schema.string),
      tags: Schema.array(Schema.string),
      point: Schema.tuple(Schema.number, Schema.number),
    });
    expect(schema.descriptor).toEqual({
      kind: "object",
      properties: [
        { name: "active", optional: false, value: { kind: "boolean" } },
        { name: "age", optional: false, value: { kind: "number" } },
        { name: "nickname", optional: true, value: { kind: "string" } },
        { name: "point", optional: false, value: { kind: "tuple", elements: [{ kind: "number" }, { kind: "number" }] } },
        { name: "tags", optional: false, value: { kind: "array", element: { kind: "string" } } },
      ],
    });
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.descriptor)).toBe(true);
    expect(Object.isFrozen((schema.descriptor as unknown as { properties: unknown[] }).properties)).toBe(true);

    const input = { active: true, age: 42, tags: ["poc"], point: [1, 2] as const };
    const direct = __vsSchema(schema.descriptor as never).parse(input);
    expect(direct.unwrap()).toEqual(schema.parse(input).unwrap());
    const ordinaryError = validationError(schema, { ...input, tags: ["ok", 7] });
    const directError = __vsSchema(schema.descriptor as never).parse({ ...input, tags: ["ok", 7] }).match({
      ok: () => { throw new Error("expected failure"); }, error: (error) => error,
    });
    expect(ordinaryError).toMatchObject({ pointer: directError.pointer, reason: directError.reason });
  });

  test("are WeakSet-branded and cannot be forged, including optional field markers", () => {
    expect(Schema.isSchema(Schema.string)).toBe(true);
    expect(Schema.isSchema({ descriptor: { kind: "string" }, parse: () => undefined })).toBe(false);
    const forged = Object.create(SchemaValue.prototype) as SchemaValue<string>;
    expect(panics(() => forged.parse("x"))).toBe(true);
    expect(panics(() => Schema.array(forged))).toBe(true);

    const optional = Schema.optional(Schema.string);
    expect(Object.isFrozen(optional)).toBe(true);
    expect(Schema.isOptionalSchema(optional)).toBe(true);
    const forgedOptional = Object.create(OptionalSchemaValue.prototype) as OptionalSchemaValue<string>;
    expect(Schema.isOptionalSchema(forgedOptional)).toBe(false);
    expect(panics(() => forgedOptional.schema)).toBe(true);
  });
});

describe("Schema parsing and refinements", () => {
  test("supports every ordinary combinator and returns deeply frozen values", () => {
    const schema = Schema.struct({
      status: Schema.union(Schema.literal("ready"), Schema.literal("waiting")),
      note: Schema.nullable(Schema.string),
      labels: Schema.record(Schema.string),
      alias: Schema.optional(Schema.string),
    });
    const value = schema.parse({ status: "ready", note: null, labels: { b: "two", a: "one" } }).unwrap();
    expect(value).toEqual({ labels: { a: "one", b: "two" }, note: null, status: "ready" });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.labels)).toBe(true);
    expect(Object.keys(value.labels)).toEqual(["a", "b"]);
  });

  test("refinements compose after structural parsing and retain exact nested paths", () => {
    const positive = Schema.number.refine((value) => value > 0, "must be positive");
    const schema = Schema.struct({ rows: Schema.array(Schema.struct({ count: positive })) });
    expect(validationError(schema, { rows: [{ count: 0 }] })).toMatchObject({
      pointer: "$.rows[0].count",
      reason: "failed refinement: must be positive",
    });
    expect(schema.parse({ rows: [{ count: 2 }] }).isOk()).toBe(true);

    // An overlapping later union variant remains available when an earlier
    // structurally matching refinement rejects the value.
    const fallback = Schema.union(positive, Schema.number);
    expect(fallback.parse(-1).unwrap()).toBe(-1);
  });

  test("describe preserves validation and descriptor identity", () => {
    const base = Schema.struct({ id: Schema.number });
    const named = base.describe("Entity");
    expect(named.descriptor).toBe(base.descriptor);
    expect(named.parse({ id: 1 }).unwrap()).toEqual({ id: 1 });
  });

  test("runtime-only record descriptors retain the shared depth budget", () => {
    let schema: SchemaType<unknown> = Schema.string;
    expect(() => {
      for (let index = 0; index < 33; index += 1) schema = Schema.record(schema);
    }).toThrow("exceeds the schema descriptor depth limit");
  });
});

describe("Schema fail-closed categories", () => {
  test("shared nodes report exact paths for required, extra, tuple, union, and array failures", () => {
    const object = Schema.struct({ name: Schema.string });
    expect(validationError(object, {})).toMatchObject({ pointer: "$.name", reason: "is required and expected string" });
    expect(validationError(object, { name: "x", extra: true })).toMatchObject({
      pointer: "$.extra", reason: "is not declared by the derived type",
    });
    expect(validationError(Schema.tuple(Schema.string, Schema.number), ["x"])).toMatchObject({
      pointer: "$", reason: "expected a 2-element tuple but received 1",
    });
    expect(validationError(Schema.union(Schema.string, Schema.boolean), 1)).toMatchObject({
      pointer: "$", reason: "expected string | boolean",
    });

    const array = ["x"] as string[];
    Object.defineProperty(array, "extra", { value: true, enumerable: true });
    expect(validationError(Schema.array(Schema.string), array)).toMatchObject({
      pointer: "$", reason: "expected a plain array without extra properties",
    });
  });

  test("record adapter fails closed on prototype, symbols, accessors, and nested values", () => {
    const records = Schema.record(Schema.number);
    expect(validationError(records, new Map())).toMatchObject({ pointer: "$", reason: "expected a record" });

    const symbol = { a: 1 } as Record<PropertyKey, unknown>;
    symbol[Symbol("x")] = 2;
    expect(validationError(records, symbol)).toMatchObject({
      pointer: "$", reason: "expected a record without symbol-keyed properties",
    });

    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "a", { enumerable: true, get: () => 1 });
    expect(validationError(records, accessor)).toMatchObject({
      pointer: "$.a", reason: "is not an enumerable data property",
    });
    expect(validationError(records, { group: "no" })).toMatchObject({ pointer: "$.group", reason: "expected number" });
  });
});

describe("Schema-derived Equivalence and Hash", () => {
  test("produce branded lawful instances for nested structures and records", () => {
    const schema = Schema.struct({
      id: Schema.number,
      flags: Schema.array(Schema.boolean),
      labels: Schema.record(Schema.string),
      note: Schema.optional(Schema.string),
    });
    const equivalence = Schema.equivalence(schema);
    const hash = Schema.hash(schema);
    const samples = [
      schema.parse({ id: 1, flags: [true], labels: { b: "2", a: "1" } }).unwrap(),
      schema.parse({ labels: { a: "1", b: "2" }, flags: [true], id: 1 }).unwrap(),
      schema.parse({ id: 2, flags: [false], labels: {}, note: "x" }).unwrap(),
    ];
    expect(Equivalence.isEquivalence(equivalence)).toBe(true);
    expect(Hash.isHash(hash)).toBe(true);
    expect(equivalence.equals(samples[0]!, samples[1]!)).toBe(true);
    expect(hash.hash(samples[0]!)).toBe(hash.hash(samples[1]!));
    expect(Hash.checkLaws(equivalence, hash, samples)).toBeUndefined();
  });
});

describe("ValidationError transport", () => {
  test("ordinary Schema failures use the shared wire-registered error", () => {
    const original = validationError(Schema.array(Schema.number), [1, "x"]);
    const decoded = decodeError(encodeError(original));
    expect(decoded).toBeInstanceOf(ValidationError);
    expect(decoded).toMatchObject({ pointer: "$[1]", reason: "expected number" });
  });
});

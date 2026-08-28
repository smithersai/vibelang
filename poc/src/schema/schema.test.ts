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

  test("both validation engines word the same rejection the same way", () => {
    // A record-free tree is parsed by `__vsSchema`; a record-bearing one routes
    // through this module's adapters. They agreed on every *semantic* question
    // and disagreed only on wording for a non-array at an array or tuple
    // position, which leaked which engine had run.
    const reason = (schema: SchemaType<never>, input: unknown): string =>
      schema.parse(input).match({ ok: () => "OK", error: (error) => error.message });

    // The one descriptor both engines can be asked about: a record sibling puts
    // the *tree* on the adapters while the build-compatible child keeps
    // `__vsSchema`, so this is the same shape asked twice.
    expect(reason(
      Schema.struct({ xs: Schema.array(Schema.number), m: Schema.record(Schema.number) }) as never,
      { xs: "nope", m: {} },
    )).toBe(reason(Schema.struct({ xs: Schema.array(Schema.number) }) as never, { xs: "nope" }));
    expect(reason(Schema.struct({ a: Schema.record(Schema.number) }) as never, "nope"))
      .toBe(reason(Schema.struct({ a: Schema.number }) as never, "nope"));

    // Where only the adapter can run — an array or tuple whose element is a
    // record — it now names the wanted shape in the build engine's form instead
    // of answering "expected a plain array", which said which engine had run.
    expect(reason(Schema.array(Schema.number) as never, "nope")).toBe("$ expected number[]");
    expect(reason(Schema.array(Schema.record(Schema.number)) as never, "nope")).toBe("$ expected a record[]");
    expect(reason(Schema.tuple(Schema.number) as never, "nope")).toBe("$ expected [number]");
    expect(reason(Schema.tuple(Schema.record(Schema.number)) as never, "nope")).toBe("$ expected [a record]");

    // The two wordings that already agreed are unchanged, in both engines.
    const exotic = Object.setPrototypeOf([], null) as unknown[];
    expect(reason(Schema.array(Schema.record(Schema.number)) as never, exotic)).toBe("$ expected a plain array");
    expect(reason(Schema.array(Schema.number) as never, exotic)).toBe("$ expected a plain array");
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

  test("compare index ownership before values, so a hole is not an own undefined", () => {
    // `Schema.equivalence` and `Schema.hash` are handed caller values directly,
    // not only parsed ones, so they meet sparse arrays that `Schema.parse`
    // already refuses. `.every` and `for…of` both skip or invent a hole.
    const list = Schema.array(Schema.nullable(Schema.string));
    const equivalence = Schema.equivalence(list);
    const hash = Schema.hash(list);
    const hole = new Array(1) as (string | null)[];
    const own = [null] as (string | null)[];

    expect(equivalence.equals(hole, own)).toBe(false);
    expect(equivalence.equals(hole, new Array(1) as (string | null)[])).toBe(true);
    expect(hash.hash(hole)).not.toBe(hash.hash(own));
    expect(hash.hash(hole)).toBe(hash.hash(new Array(1) as (string | null)[]));
    expect(Hash.checkLaws(equivalence, hash, [hole, own, new Array(1) as (string | null)[]])).toBeUndefined();

    const pair = Schema.tuple(Schema.nullable(Schema.string), Schema.nullable(Schema.string));
    const pairEquivalence = Schema.equivalence(pair);
    const pairHash = Schema.hash(pair);
    const sparsePair = new Array(2) as [string | null, string | null];
    expect(pairEquivalence.equals(sparsePair, [null, null])).toBe(false);
    expect(pairHash.hash(sparsePair)).not.toBe(pairHash.hash([null, null]));

    // And parsing still refuses the hole outright, as it always did.
    expect(list.parse(hole).isError()).toBe(true);
  });
});

describe("ValidationError transport", () => {
  test("validates a path through its holes, not around them", () => {
    // The fourth copy of one pattern: `path.map` never calls its callback on a
    // hole, so the segment check was skipped and `$.undefined` was rendered.
    // `DecodeError`, `JsonEncodeError`, and `JsonSchemaError` had it too.
    expect(() => new ValidationError(new Array(1) as never, "boom")).toThrow(
      "ValidationError path segments must be strings or array indices",
    );
    expect(() => new ValidationError([undefined as never], "boom")).toThrow(
      "ValidationError path segments must be strings or array indices",
    );
    expect(new ValidationError(["rows", 2], "boom").pointer).toBe("$.rows[2]");
  });

  test("ordinary Schema failures use the shared wire-registered error", () => {
    const original = validationError(Schema.array(Schema.number), [1, "x"]);
    const decoded = decodeError(encodeError(original));
    expect(decoded).toBeInstanceOf(ValidationError);
    expect(decoded).toMatchObject({ pointer: "$[1]", reason: "expected number" });
  });
});

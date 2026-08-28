import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { SeededRandom } from "../platform/random.ts";
import { RuntimeValues, decodeError, encodeError } from "../runtime/index.ts";
import type { Result } from "../runtime/result.ts";
import { Codec, CodecValue, DecodeError } from "./codec.ts";
import { Json } from "./json.ts";

const { failure, success } = RuntimeValues;

function errorOf(result: Result<unknown, DecodeError>): DecodeError {
  return result.match({ ok: () => { throw new Error("expected failure"); }, error: (error) => error });
}

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

describe("Codec values", () => {
  test("are frozen, WeakSet-branded, and non-forgeable", () => {
    expect(Object.isFrozen(Codec.string)).toBe(true);
    expect(Codec.isCodec(Codec.string)).toBe(true);
    expect(String(Codec.string)).toBe("[object Codec]");
    expect(Codec.isCodec({ encode: (value: string) => value, decode: () => success("") })).toBe(false);

    const forged = Object.create(CodecValue.prototype) as CodecValue<string, string>;
    expect(Codec.isCodec(forged)).toBe(false);
    expect(panics(() => forged.encode("x"))).toBe(true);
    expect(panics(() => Codec.array(forged))).toBe(true);
  });

  test("make validates its construction boundary and decoder Result brand", () => {
    expect(panics(() => Codec.make(null as never, () => success("x")))).toBe(true);
    const broken = Codec.make((value: string) => value, (() => ({ ok: true })) as never);
    expect(panics(() => broken.decode("x"))).toBe(true);
  });
});

describe("Codec round-trip laws", () => {
  test("hold for every canonical scalar", () => {
    expect(Codec.checkRoundTrip(Codec.string, ["", "smithers", "😀"])).toBeUndefined();
    expect(Codec.checkRoundTrip(Codec.number, [0, -0, 1.25, Number.MAX_VALUE])).toBeUndefined();
    expect(Codec.checkRoundTrip(Codec.boolean, [true, false])).toBeUndefined();
    expect(Codec.checkRoundTrip(Codec.null, [null])).toBeUndefined();
    expect(Codec.checkRoundTrip(Codec.literal("ready"), ["ready"])).toBeUndefined();
  });

  test("hold for array, tuple, struct, union, nullable, and optional", () => {
    const pair = Codec.tuple(Codec.string, Codec.number);
    const account = Codec.struct({ id: Codec.number, tags: Codec.array(Codec.string), pair });
    const choice = Codec.union(Codec.string, Codec.number, Codec.boolean);
    expect(Codec.checkRoundTrip(pair, [["a", 1], ["", 0]])).toBeUndefined();
    expect(Codec.checkRoundTrip(account, [
      { id: 1, tags: ["a", "b"], pair: ["x", 2] },
      { id: 2, tags: [], pair: ["y", 0] },
    ])).toBeUndefined();
    expect(Codec.checkRoundTrip(choice, ["a", 2, false])).toBeUndefined();
    expect(Codec.checkRoundTrip(Codec.nullable(Codec.string), [null, "x"])).toBeUndefined();
    // `Codec.optional` is a codec over `Domain | undefined`: absence is the
    // ordinary union member, and a falsy present value stays present.
    expect(Codec.checkRoundTrip(Codec.optional(Codec.number), [undefined, 1, 0])).toBeUndefined();
    const numbers = Codec.optional(Codec.number);
    expect(numbers.decode(undefined).unwrap()).toBeUndefined();
    expect(numbers.decode(0).unwrap()).toBe(0);
    expect(numbers.encode(undefined)).toBeUndefined();
    expect(numbers.encode(0)).toBe(0);
    expect(numbers.decode("nope" as never).isError()).toBe(true);
    expect((numbers.decode(undefined).unwrap() ?? -1)).toBe(-1);
    expect((numbers.decode(0).unwrap() ?? -1)).toBe(0);
  });

  test("an optional struct field is an omitted key, so it survives a JSON boundary", () => {
    // `Codec.optional` builds a codec over `Domain | undefined`, which is a
    // *present* field holding `undefined`. JSON cannot spell that, so used as a
    // struct field it was dead in both directions: encoding produced a wire
    // `Json.stringify` refused, and the key-omitted form JSON actually carries
    // was refused by `struct.decode`. `Codec.optionalField` is the field marker,
    // mirroring `Schema.optional`.
    const codec = Codec.struct({ a: Codec.optionalField(Codec.string), b: Codec.number });

    const absent = codec.encode({ b: 1 });
    expect(Object.keys(absent as object)).toEqual(["b"]);
    expect(Json.stringify(absent as never).unwrap()).toBe(`{"b":1}`);
    expect(Object.keys(codec.decode(absent).unwrap() as object)).toEqual(["b"]);

    const present = codec.encode({ a: "x", b: 1 });
    expect(Object.keys(present as object)).toEqual(["a", "b"]);
    expect(Json.stringify(present as never).unwrap()).toBe(`{"a":"x","b":1}`);
    expect(codec.decode(present).unwrap()).toMatchObject({ a: "x", b: 1 });

    // The law holds for both shapes, and a full JSON round trip closes the loop.
    expect(Codec.checkRoundTrip(codec, [{ b: 1 }, { a: "x", b: 1 }])).toBeUndefined();
    for (const sample of [{ b: 1 }, { a: "x", b: 1 }]) {
      const text = Json.stringify(codec.encode(sample) as never).unwrap();
      expect(codec.decode(Json.parse(text).unwrap() as never).unwrap()).toEqual(sample as never);
    }

    // A present optional field still has to satisfy its codec, and an omitted
    // *required* field is still a failure — absence is not a wildcard.
    expect(errorOf(codec.decode({ a: 5, b: 1 } as never))).toMatchObject({ pointer: "$.a", reason: "expected string" });
    expect(errorOf(codec.decode({ a: "x" } as never))).toMatchObject({
      pointer: "$.b",
      reason: "is required and must be an enumerable data property",
    });
    expect(errorOf(codec.decode({ a: "x", b: 1, c: true } as never))).toMatchObject({
      pointer: "$.c",
      reason: "is not declared by the codec",
    });
    expect(() => codec.encode({ b: 1, c: true } as never)).toThrow("expected exactly the declared data fields");
    expect(panics(() => Codec.struct({ a: {} as never }))).toBe(true);
  });

  test("hold through imap, fallible map, and composition", () => {
    const numericText = Codec.imap(Codec.string, (text) => Number(text), (value: number) => String(value));
    const integer = Codec.map(
      Codec.number,
      (value) => Number.isInteger(value) ? success(value) : failure(new DecodeError([], "expected an integer")),
      (value: number) => value,
    );
    const identityText = Codec.make((value: string) => value, (wire: string) => success(wire));
    const composed = Codec.compose(numericText, identityText);
    const numberWire = Codec.make(
      (value: number) => `n:${value}`,
      (wire: string) => wire.startsWith("n:") ? success(Number(wire.slice(2))) : failure(new DecodeError([], "not n")),
      (value): value is number => typeof value === "number",
    );
    const booleanWire = Codec.make(
      (value: boolean) => `b:${value}`,
      (wire: string) => wire === "b:true" ? success(true) : wire === "b:false" ? success(false) : failure(new DecodeError([], "not b")),
      (value): value is boolean => typeof value === "boolean",
    );
    const customUnion = Codec.union(numberWire, booleanWire);
    expect(Codec.checkRoundTrip(numericText, [0, 1, -42, 1.5])).toBeUndefined();
    expect(Codec.checkRoundTrip(integer, [0, 1, -42])).toBeUndefined();
    expect(Codec.checkRoundTrip(composed, [0, 7, -9])).toBeUndefined();
    expect(Codec.checkRoundTrip(customUnion, [1, false, 2, true])).toBeUndefined();
    expect(errorOf(integer.decode(1.5)).reason).toBe("expected an integer");
  });

  test("the law helper identifies a changed value", () => {
    const lossy = Codec.imap(Codec.string, (value) => value.toLowerCase(), (value: string) => value);
    expect(Codec.checkRoundTrip(lossy, ["LOUD"]) ?? "").toBe("round-trip changed sample 0");
  });

  test("a shape change counts as a changed value, holes included", () => {
    // The reviewer's case. `new Array(1)` has no own `0`; the encoder used to
    // hand back `[undefined]`, which does, and the law comparator ran
    // `left.every`, which skips a hole — so the law certified a transformation
    // that changed the value's own enumerable keys.
    const tuple = Codec.tuple(Codec.optional(Codec.string));
    expect(Codec.checkRoundTrip(tuple, [new Array(1) as never]) ?? "").toContain("encode threw at sample 0");
    expect(Codec.checkRoundTrip(tuple, [[undefined] as never, ["x"] as never])).toBeUndefined();

    const list = Codec.array(Codec.optional(Codec.string));
    expect(Codec.checkRoundTrip(list, [new Array(2) as never]) ?? "").toContain("encode threw at sample 0");
    expect(Codec.checkRoundTrip(list, [[undefined, "x"] as never])).toBeUndefined();

    // A sparse *sample set* would silently test `undefined` in the hole's place.
    expect(panics(() => Codec.checkRoundTrip(Codec.string, new Array(1) as never))).toBe(true);
  });

  test("a custom codec's own probe compares index ownership before values", () => {
    // `Codec.make` without an explicit predicate identifies its domain by
    // encoding, decoding, and comparing. Spreading densifies, so this codec does
    // change a sparse input's shape; the comparator has to notice, or the
    // union below picks a variant that silently rewrites the value.
    const spreading = Codec.make(
      (value: readonly (string | undefined)[]) => [...value] as readonly (string | undefined)[],
      (wire: readonly (string | undefined)[]) => success([...wire] as readonly (string | undefined)[]),
    );
    const chooser = Codec.union(spreading as never, Codec.string);
    expect(() => chooser.encode(new Array(1) as never)).toThrow("matches no variant");
    expect(chooser.encode(["a"] as never)).toEqual(["a"] as never);
    expect(chooser.encode("plain" as never)).toBe("plain" as never);
  });

  test("a seeded sweep of arrays with holes: the law certifies only what kept its shape", () => {
    const random = SeededRandom.withSeed(0x5eed_1a3f);
    const shapes = [
      { name: "array", codec: Codec.array(Codec.optional(Codec.string)) },
      { name: "tuple-3", codec: Codec.tuple(...Array.from({ length: 3 }, () => Codec.optional(Codec.string))) },
    ] as const;

    for (let trial = 0; trial < 400; trial += 1) {
      const shape = shapes[random.int(0, shapes.length)]!;
      const length = shape.name === "array" ? random.int(0, 5) : 3;
      const sample = new Array<string | undefined>(length);
      let holes = 0;
      for (let index = 0; index < length; index += 1) {
        const draw = random.int(0, 3);
        // draw 0 leaves the index a hole; the other two write an own property,
        // one of which is an own `undefined` — the value a hole impersonates.
        if (draw === 0) holes += 1;
        else sample[index] = draw === 1 ? undefined : `s${index}`;
      }

      const verdict = Codec.checkRoundTrip(shape.codec, [sample as never]);
      const label = `${shape.name}#${trial} holes=${holes} keys=${Object.keys(sample).join(",")}`;
      if (holes === 0) {
        expect([label, verdict]).toEqual([label, undefined]);
        const decoded = shape.codec.decode(shape.codec.encode(sample as never)).unwrap() as readonly unknown[];
        // Certified means certified: the own enumerable keys survived intact.
        expect([label, Object.keys(decoded)]).toEqual([label, Object.keys(sample)]);
      } else {
        // A sparse sample can never be certified, because it can never be encoded.
        expect([label, verdict === undefined]).toEqual([label, false]);
      }
    }
  });
});

describe("Codec fail-closed decoding", () => {
  test("reports nested scalar paths exactly", () => {
    const codec = Codec.struct({ rows: Codec.array(Codec.struct({ count: Codec.number })) });
    const decoded = codec.decode({ rows: [{ count: "no" }] } as never);
    const error = decoded.match({ ok: () => { throw new Error("expected failure"); }, error: (cause) => cause });
    expect(error.pointer).toBe("$.rows[0].count");
    expect(error.reason).toBe("expected finite number");
  });

  test("rejects tuple arity, missing fields, extras, and union misses", () => {
    const tuple = Codec.tuple(Codec.string, Codec.number);
    expect(errorOf(tuple.decode(["x"] as never))).toMatchObject({ pointer: "$", reason: "expected a 2-element tuple but received 1" });

    const item = Codec.struct({ name: Codec.string });
    expect(errorOf(item.decode({} as never))).toMatchObject({ pointer: "$.name", reason: "is required and must be an enumerable data property" });
    expect(errorOf(item.decode({ name: "x", extra: true } as never))).toMatchObject({ pointer: "$.extra", reason: "is not declared by the codec" });
    expect(errorOf(Codec.union(Codec.string, Codec.boolean).decode(42 as never))).toMatchObject({
      pointer: "$",
      reason: "did not match any union variant (expected string; expected boolean)",
    });
  });

  /**
   * The old name for this suite's arity test claimed "sparse arrays" while
   * exercising `Codec.array.decode` alone, so deleting the tuple encoder's check
   * or the round-trip law's ownership requirement left it green. Every direction
   * a sparse array can enter a codec is asserted here instead, and the claim now
   * lives on a test that makes it.
   */
  test("rejects a sparse array in every direction: array and tuple, encode and decode", () => {
    const sparse = new Array(2) as string[];
    sparse[0] = "x";
    expect(errorOf(Codec.array(Codec.string).decode(sparse))).toMatchObject({
      pointer: "$[1]",
      reason: "is a sparse array hole",
    });
    expect(() => Codec.array(Codec.string).encode(sparse)).toThrow("sparse hole at 1");

    const pair = Codec.tuple(Codec.string, Codec.optional(Codec.string));
    expect(errorOf(pair.decode(sparse as never))).toMatchObject({ pointer: "$[1]", reason: "is a sparse tuple hole" });
    expect(() => pair.encode(sparse as never)).toThrow("sparse hole at 1");

    // The whole hole: `new Array(1)` against a tuple whose one member accepts
    // `undefined`, which is the only case where reading the hole "works".
    const single = Codec.tuple(Codec.optional(Codec.string));
    expect(() => single.encode(new Array(1) as never)).toThrow("sparse hole at 0");
    expect(errorOf(single.decode(new Array(1) as never))).toMatchObject({
      pointer: "$[0]",
      reason: "is a sparse tuple hole",
    });

    // `accepts` drives union variant selection, so it has to agree with encode.
    // It used to say yes (`.every` skips holes) and then encode threw, which is
    // a TypeError escaping a union that promised to fail closed.
    const chooser = Codec.union(single as never, Codec.string);
    expect(() => chooser.encode(new Array(1) as never)).toThrow("matches no variant");
    const listChooser = Codec.union(Codec.array(Codec.optional(Codec.string)) as never, Codec.string);
    expect(() => listChooser.encode(new Array(1) as never)).toThrow("matches no variant");
  });

  test("a DecodeError path is validated through its holes, not around them", () => {
    // `path.map` skips a hole without calling the validator, so a sparse path
    // used to slip past the segment check and render as `$.undefined`.
    expect(() => new DecodeError(new Array(1) as never, "boom")).toThrow(
      "DecodeError path segments must be strings or array indices",
    );
    expect(() => new DecodeError([undefined as never], "boom")).toThrow(
      "DecodeError path segments must be strings or array indices",
    );
    expect(new DecodeError(["rows", 2], "boom").pointer).toBe("$.rows[2]");
  });

  test("turns hostile wire inspection into a stable Result failure", () => {
    const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error("trap"); } });
    expect(errorOf(Codec.struct({ value: Codec.string }).decode(hostile as never))).toMatchObject({
      pointer: "$",
      reason: "decoder could not inspect wire safely",
    });
  });
});

describe("DecodeError wire identity", () => {
  test("round-trips path and reason through the nominal Error registry", () => {
    const original = new DecodeError(["rows", 2, "name"], "expected string");
    const decoded = decodeError(encodeError(original));
    expect(decoded).toBeInstanceOf(DecodeError);
    expect(decoded).toMatchObject({ pointer: "$.rows[2].name", reason: "expected string" });
  });
});

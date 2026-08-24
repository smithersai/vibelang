import { describe, expect, test } from "bun:test";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { RuntimeValues, decodeError, encodeError } from "../runtime/index.ts";
import type { Result } from "../runtime/result.ts";
import { Codec, CodecValue, DecodeError } from "./codec.ts";

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
});

describe("Codec fail-closed decoding", () => {
  test("reports nested scalar paths exactly", () => {
    const codec = Codec.struct({ rows: Codec.array(Codec.struct({ count: Codec.number })) });
    const decoded = codec.decode({ rows: [{ count: "no" }] } as never);
    const error = decoded.match({ ok: () => { throw new Error("expected failure"); }, error: (cause) => cause });
    expect(error.pointer).toBe("$.rows[0].count");
    expect(error.reason).toBe("expected finite number");
  });

  test("rejects tuple arity, sparse arrays, missing fields, extras, and union misses", () => {
    const tuple = Codec.tuple(Codec.string, Codec.number);
    expect(errorOf(tuple.decode(["x"] as never))).toMatchObject({ pointer: "$", reason: "expected a 2-element tuple but received 1" });

    const sparse = new Array(2) as string[];
    sparse[0] = "x";
    expect(errorOf(Codec.array(Codec.string).decode(sparse))).toMatchObject({ pointer: "$[1]", reason: "is a sparse array hole" });

    const item = Codec.struct({ name: Codec.string });
    expect(errorOf(item.decode({} as never))).toMatchObject({ pointer: "$.name", reason: "is required and must be an enumerable data property" });
    expect(errorOf(item.decode({ name: "x", extra: true } as never))).toMatchObject({ pointer: "$.extra", reason: "is not declared by the codec" });
    expect(errorOf(Codec.union(Codec.string, Codec.boolean).decode(42 as never))).toMatchObject({
      pointer: "$",
      reason: "did not match any union variant (expected string; expected boolean)",
    });
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

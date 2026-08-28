import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../durable/value.ts";
import { decodeError, encodeError } from "../runtime/index.ts";
import {
  Json,
  JsonEncodeError,
  JsonParseError,
  MAX_JSON_BYTES,
  MAX_JSON_NODES,
} from "./json.ts";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("Json.parse", () => {
  test("returns frozen ordinary JSON and never throws for syntax failures", () => {
    const parsed = Json.parse('{"name":"smithers","values":[1,true,null]}');
    const value = parsed.unwrap() as { name: string; values: unknown[] };
    expect(value).toEqual({ name: "smithers", values: [1, true, null] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.values)).toBe(true);

    let result: ReturnType<typeof Json.parse> | undefined;
    expect(() => { result = Json.parse('{"broken":'); }).not.toThrow();
    expect(result?.isError()).toBe(true);
    expect(result?.match({ ok: () => "", error: (error) => error.message })).toBe("$ contains invalid JSON syntax");
  });

  test("fails closed on durable-incompatible negative zero and unpaired Unicode", () => {
    expect(Json.parse("-0").match({ ok: () => "", error: (error) => error.message })).toBe("$ contains negative zero");
    expect(Json.parse('"\\ud800"').match({ ok: () => "", error: (error) => error.message })).toBe(
      "$ contains an unpaired high surrogate",
    );
  });
});

describe("Json.stringify fail-closed validation", () => {
  test("reports exact paths for unsafe scalar and container categories", () => {
    expect(Json.stringify({ rows: [{ amount: Number.POSITIVE_INFINITY }] }).match({
      ok: () => "", error: (error) => error.message,
    })).toBe("$.rows[0].amount contains a non-finite number");
    expect(Json.stringify({ minus: -0 }).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$.minus contains negative zero",
    );

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(Json.stringify(cyclic).match({ ok: () => "", error: (error) => error.message })).toBe("$.self contains a cycle");
    expect(Json.stringify(new Date(0)).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$ is not a plain JSON object",
    );
    class FancyArray extends Array<unknown> {}
    expect(Json.stringify(new FancyArray(1)).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$ is not a plain JSON array",
    );
    expect(Json.stringify(undefined).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$ contains a non-JSON undefined value",
    );

    const sparse = new Array(2);
    sparse[0] = true;
    expect(Json.stringify(sparse).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$[1] is a sparse array hole",
    );
    const extra = [true] as unknown[] & { extra?: boolean };
    extra.extra = true;
    expect(Json.stringify(extra).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$ has unexpected array property extra",
    );

    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "secret", { enumerable: true, get: () => 1 });
    expect(Json.stringify(accessor).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$.secret is an accessor or hidden property",
    );

    const symbol = { ok: true } as Record<PropertyKey, unknown>;
    symbol[Symbol("hidden")] = true;
    expect(Json.stringify(symbol).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$ has a symbol-keyed property",
    );
  });

  test("bounds depth, node count, and UTF-8 bytes with stable errors", () => {
    let deep: unknown = null;
    for (let index = 0; index < 257; index += 1) deep = [deep];
    const depthError = Json.stringify(deep).match({ ok: () => undefined, error: (error) => error });
    expect(depthError).toBeInstanceOf(JsonEncodeError);
    expect(depthError?.path).toHaveLength(257);
    expect(depthError?.reason).toBe("exceeds the JSON nesting limit");

    const many = Array.from({ length: MAX_JSON_NODES }, () => null);
    const nodeError = Json.stringify(many).match({ ok: () => undefined, error: (error) => error });
    expect(nodeError).toMatchObject({ pointer: "$[99999]", reason: "exceeds the JSON node limit" });

    const oversized = "x".repeat(MAX_JSON_BYTES + 1);
    expect(Json.stringify(oversized).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$ exceeds the JSON byte limit",
    );
    expect(Json.parse(oversized).match({ ok: () => "", error: (error) => error.message })).toBe(
      "$ exceeds the JSON byte limit",
    );
  });
});

describe("Json canonical bytes", () => {
  test("are byte-identical across runs and stable under key reordering", () => {
    const left = { z: [3, { y: false, x: "text" }], a: 0.000001, n: 1e21 };
    const right = { n: 1e21, a: 0.000001, z: [3, { x: "text", y: false }] };
    const first = Json.canonical(left).unwrap();
    const independent = Json.canonical(left).unwrap();
    const reordered = Json.canonical(right).unwrap();
    expect(first).toEqual(independent);
    expect(first).toEqual(reordered);
    expect(text(first)).toBe('{"a":0.000001,"n":1e+21,"z":[3,{"x":"text","y":false}]}');

    const moduleUrl = new URL("./json.ts", import.meta.url).href;
    const program = [
      `import { Json } from ${JSON.stringify(moduleUrl)};`,
      `const value = { z: [3, { y: false, x: "text" }], a: 0.000001, n: 1e21 };`,
      `process.stdout.write(Buffer.from(Json.canonical(value).unwrap()).toString("hex"));`,
    ].join("\n");
    const independentRun = (): string => {
      const child = Bun.spawnSync({ cmd: [process.execPath, "-e", program], stderr: "pipe", stdout: "pipe" });
      expect(child.exitCode).toBe(0);
      return text(child.stdout);
    };
    expect(independentRun()).toBe(independentRun());
  });

  test("agrees byte-for-byte with the durable canonical encoder where grammars overlap", () => {
    const values = [
      null,
      true,
      "😀",
      1.25,
      [1, "two", false],
      { zebra: 1, alpha: { c: null, b: [2, 3] } },
    ];
    for (const value of values) expect(text(Json.canonical(value).unwrap())).toBe(canonicalJson(value));
  });
});

describe("JSON nominal errors", () => {
  test("wire-round-trip both parse and encode failures", () => {
    const errors = [
      new JsonParseError(["input"], "invalid"),
      new JsonEncodeError(["rows", 3], "contains a cycle"),
    ];
    for (const error of errors) {
      const decoded = decodeError(encodeError(error));
      expect(decoded.constructor).toBe(error.constructor);
      expect(decoded).toMatchObject({ path: error.path, reason: error.reason });
    }
  });
});

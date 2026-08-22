import { describe, expect, test } from "bun:test";
import { Result, RuntimeValues, __vsInspectResult } from "../runtime/index.ts";
import { allKeyed, allSettledKeyed } from "./keyed.ts";

describe("keyed Promise combinators", () => {
  test("preserves enumerable own string and symbol keys in proposal order", async () => {
    const symbol = Symbol("symbol-result");
    const prototype = { inherited: Promise.resolve("ignored") };
    const input = Object.create(prototype) as Record<PropertyKey, unknown>;
    input.first = Bun.sleep(4).then(() => "first");
    input.second = Promise.resolve("second");
    input[symbol] = Promise.resolve("symbol");
    Object.defineProperty(input, "hidden", { enumerable: false, value: Promise.resolve("hidden") });

    const result = await allKeyed(input);

    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Reflect.ownKeys(result)).toEqual(["first", "second", symbol]);
    expect(result.first).toBe("first");
    expect(result.second).toBe("second");
    expect(result[symbol]).toBe("symbol");
    expect(Object.hasOwn(result, "hidden")).toBe(false);
    expect(Object.hasOwn(result, "inherited")).toBe(false);
  });

  test("rejects with the first input rejection while observing later rejections", async () => {
    const first = new RangeError("first rejection");
    const later = new Error("later rejection");
    const promise = allKeyed({
      slow: Bun.sleep(5).then(() => { throw later; }),
      fast: Promise.reject(first),
    });

    await expect(promise).rejects.toBe(first);
    await Bun.sleep(10);
  });

  test("observes started inputs when a later property getter throws", async () => {
    const inputFailure = new Error("input rejected");
    const getterFailure = new SyntaxError("getter failed");
    const input: Record<string, unknown> = { started: Promise.reject(inputFailure) };
    Object.defineProperty(input, "broken", {
      enumerable: true,
      get() { throw getterFailure; },
    });

    await expect(allKeyed(input)).rejects.toBe(getterFailure);
    await Bun.sleep(0);
  });

  test("allSettledKeyed retains keyed fulfillment and rejection records", async () => {
    const reason = new TypeError("not available");
    const result = await allSettledKeyed({
      count: Promise.resolve(3 as const),
      missing: Promise.reject(reason),
      plain: "ready" as const,
    });

    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(result.count).toEqual({ status: "fulfilled", value: 3 });
    expect(result.missing).toEqual({ status: "rejected", reason });
    expect(result.plain).toEqual({ status: "fulfilled", value: "ready" });
  });

  test("composes Result.all over allKeyed for expected failures", async () => {
    const expected = new Error("typed domain failure");
    const keyed = await allKeyed({
      profile: Promise.resolve(RuntimeValues.success("profile")),
      activity: Promise.resolve(RuntimeValues.failure(expected)),
    });

    const combined = Result.all(Object.values(keyed));
    const state = __vsInspectResult(combined);
    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("expected Result.all failure");
    expect(state.error).toBe(expected);
  });

  test("uses null-prototype data properties for hostile names and empty inputs", async () => {
    const input = Object.create(null) as Record<string, Promise<number>>;
    Object.defineProperty(input, "__proto__", { enumerable: true, value: Promise.resolve(1) });
    const result = await allKeyed(input);
    const empty = await allSettledKeyed({});

    expect(result["__proto__"]).toBe(1);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.getPrototypeOf(empty)).toBeNull();
    expect(Reflect.ownKeys(empty)).toEqual([]);
  });
});

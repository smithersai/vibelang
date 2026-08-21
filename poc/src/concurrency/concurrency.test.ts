import { describe, expect, test } from "bun:test";
import { Cancelled, Cancellation, awaitAll, mapUnordered } from "./index.ts";
import { catchFailure, isVibeFailure } from "../runtime/failure.ts";

describe("structured concurrency without fibers", () => {
  test("awaitAll preserves tuple order", async () => {
    const joined = await awaitAll(
      (async () => { await Bun.sleep(3); return "profile" as const; })(),
      (async () => { await Bun.sleep(1); return "activity" as const; })(),
    );
    expect(joined).toEqual(["profile", "activity"]);
  });

  test("cancellation is a branded typed failure", async () => {
    const cancellation = new Cancellation();
    cancellation.cancel("test stop");
    try {
      cancellation.check();
      throw new Error("expected cancellation");
    } catch (error) {
      expect(error).toBeInstanceOf(Cancelled);
      expect((error as Record<PropertyKey, unknown>)[Symbol.for("vibelang.failure")]).toBe(true);
      expect(isVibeFailure(error)).toBe(true);
    }
    expect(catchFailure(() => cancellation.check(), (failure) => failure._tag)).toBe("Cancelled");
  });

  test("unordered mapping yields completion order with a bound", async () => {
    const output: number[] = [];
    for await (const value of mapUnordered([5, 1, 2], 2, async (delay) => {
      await Bun.sleep(delay * 2);
      return delay;
    })) output.push(value);
    expect(output).toEqual([1, 2, 5]);
  });

  test("breaking unordered iteration cancels and joins active mappers", async () => {
    const cancellation = new Cancellation();
    const finished: number[] = [];
    for await (const value of mapUnordered([1, 30], 2, async (delay, token) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        token.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Cancelled()); }, { once: true });
      });
      finished.push(delay);
      return delay;
    }, cancellation)) {
      expect(value).toBe(1);
      break;
    }
    expect(cancellation.signal.aborted).toBe(true);
    expect(finished).toEqual([1]);
    expect(() => mapUnordered([], 0, async () => 1)).not.toThrow();
    await expect(async () => {
      for await (const _value of mapUnordered([], 0, async () => 1)) { /* none */ }
    }).toThrow();
  });
});

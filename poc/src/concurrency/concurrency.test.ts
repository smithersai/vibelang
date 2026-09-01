import { describe, expect, test } from "bun:test";
import { Cancelled, Cancellation, awaitAll, mapUnordered } from "./index.ts";
import { Layer } from "../runtime/layer.ts";
import { HostScheduler, Scheduler } from "./scheduler.ts";
import { decodeError, encodeError, errorIdentity } from "../runtime/errors.ts";
import { __vsInspectResult } from "../runtime/result.ts";

/**
 * Provide only a `Scheduler`. These call sites pass their cancellation
 * explicitly, so they need the other half of the root environment and nothing
 * more.
 */
const withScheduler = <T>(body: () => T): T =>
  Layer.provide(Layer.succeed(Scheduler, HostScheduler.make()), body);

/**
 * The root environment a combinator needs: a cancellation token and a
 * scheduler.
 *
 * `Scheduler` became a required platform service when the last `Promise.race`
 * was routed onto `firstReady`, so every combinator CONSTRUCTION needs one in
 * scope. `HostScheduler` is the right one here: these tests assert real
 * completion order, which is exactly what the live scheduler reproduces. The
 * cancellation half is minted here rather than inside the dispatcher, which is
 * where the shorthand shapes used to conjure an invisible one nobody could
 * reach; each test keeps its original meaning — no cancellation is exercised —
 * but the token is now the caller's.
 */
const rootLayer = (cancellation: Cancellation) =>
  Layer.merge(Layer.succeed(Cancellation, cancellation), Layer.succeed(Scheduler, HostScheduler.make()));

const withRootCancellation = <T>(body: () => T): T =>
  Layer.provide(rootLayer(new Cancellation()), body);

describe("structured concurrency without fibers", () => {
  test("awaitAll preserves tuple order", async () => {
    const joined = await awaitAll(
      (async () => { await Bun.sleep(3); return "profile" as const; })(),
      (async () => { await Bun.sleep(1); return "activity" as const; })(),
    );
    expect(joined).toEqual(["profile", "activity"]);
  });

  test("cancellation is a nominal typed Result and has a strict transport codec", () => {
    const cancellation = new Cancellation();
    cancellation.cancel("test stop");
    expect(cancellation.cancel("again")).toBe(false);
    const checkpoint = __vsInspectResult(cancellation.checkpoint());
    expect(checkpoint.ok).toBe(false);
    if (checkpoint.ok) throw new Error("expected cancellation");
    expect(checkpoint.error).toBeInstanceOf(Cancelled);
    expect(checkpoint.error.is(Cancelled)).toBe(true);
    expect(errorIdentity(checkpoint.error)).toBe("smithers:Cancelled@1");
    const decoded = decodeError(encodeError(checkpoint.error));
    expect(decoded).toBeInstanceOf(Cancelled);
    expect(decoded.message).toBe("test stop");
    expect(() => cancellation.check()).toThrow(Cancelled);
  });

  test("unordered mapping yields completion order with a bound", async () => {
    const output: number[] = [];
    for await (const value of withRootCancellation(() => mapUnordered([5, 1, 2], 2, async (delay) => {
      await Bun.sleep(delay * 2);
      return delay;
    }))) output.push(value);
    expect(output).toEqual([1, 2, 5]);
  });

  test("breaking unordered iteration cancels its child token, joins mappers, and leaves its parent alive", async () => {
    const parent = new Cancellation();
    const layer = rootLayer(parent);
    const finished: number[] = [];
    let child: Cancellation | undefined;
    const mapped = Layer.provide(layer, () => mapUnordered([1, 30], async (delay, token) => {
      child = token;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        token.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Cancelled()); }, { once: true });
      });
      finished.push(delay);
      return delay;
    }, { concurrency: 2 }));
    for await (const value of mapped) {
      expect(value).toBe(1);
      break;
    }
    expect(parent.signal.aborted).toBe(false);
    expect(child?.signal.aborted).toBe(true);
    expect(finished).toEqual([1]);
    expect(() => withScheduler(() => mapUnordered([], 0, async () => 1))).toThrow("positive integer");
  });

  test("unordered mapping consumes async inputs and reports mapper failures after cleanup", async () => {
    let releaseFailure!: () => void;
    const siblingStarted = new Promise<void>((resolve) => { releaseFailure = resolve; });
    async function* inputs() {
      yield 2;
      yield 3;
    }
    const parent = new Cancellation();
    const stopped: number[] = [];
    await expect(async () => {
      for await (const _value of withScheduler(() => mapUnordered(inputs(), 2, async (value, token) => {
        if (value === 2) {
          await siblingStarted;
          throw new RangeError("mapper failed");
        }
        if (value === 3) {
          releaseFailure();
          await token.whenCancelled().then(() => { stopped.push(value); });
        }
        return value;
      }, parent))) { /* drain */ }
    }).toThrow("mapper failed");
    expect(parent.aborted).toBe(false);
    expect(stopped).toEqual([3]);
  });

  test("parent cancellation propagates to the combinator child without rejecting hidden work", async () => {
    const parent = new Cancellation();
    const iteration = withScheduler(() => mapUnordered([1], 1, async (_value, token) => {
      const cancelled = await token.whenCancelled();
      throw cancelled;
    }, parent));
    const next = iteration.next();
    parent.cancel("parent stopped");
    await expect(next).rejects.toThrow("parent stopped");
  });

  test("parent cancellation interrupts a pending async source pull", async () => {
    const parent = new Cancellation();
    let sourceClosed = false;
    const hangingSource: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => { /* deliberately pending */ }),
          return: async () => {
            sourceClosed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const iteration = withScheduler(() => mapUnordered(hangingSource, 1, async (value) => value, parent));
    const next = iteration.next();
    parent.cancel("stop source");
    await expect(next).rejects.toThrow("stop source");
    expect(sourceClosed).toBe(true);
  });
});

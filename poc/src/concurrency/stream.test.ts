import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { UnhandledException, __vsInspectResult } from "../runtime/index.ts";
import {
  Cancellation,
  CancellationSource,
  Cancelled,
  Governor,
  Stream,
  isStream,
} from "./index.ts";
import { Layer } from "../runtime/layer.ts";
import { HostScheduler, Scheduler } from "./scheduler.ts";

/**
 * Provide a root cancellation for the shorthand combinator shapes.
 *
 * `Stream.mapConcurrent`'s shorthand reaches `mapUnordered`'s shorthand, whose
 * call sites used to get an invisible `new Cancellation()` minted inside the
 * dispatcher, which nobody could reach and therefore nobody could cancel.
 * Minting it here instead keeps each test's original meaning — no cancellation
 * is exercised — while making the token the caller's, which is the whole point
 * of the change.
 *
 * A Stream defers that resolution to its first pull rather than doing it at
 * construction, and `Layer.provide` refuses an async body on this host. So the
 * run is STARTED inside the layer and awaited outside it: the first pull
 * happens in the synchronous prefix of `runCollect`/`for await`, while the
 * environment is still open.
 */
/**
 * The root environment a combinator needs: a cancellation token and a
 * scheduler.
 *
 * `Scheduler` became a required platform service when the last `Promise.race`
 * was routed onto `firstReady`, so every combinator CONSTRUCTION needs one in
 * scope. `HostScheduler` is the right one here: these tests assert real
 * completion order, which is exactly what the live scheduler reproduces.
 */
const rootLayer = (cancellation: Cancellation) =>
  Layer.merge(Layer.succeed(Cancellation, cancellation), Layer.succeed(Scheduler, HostScheduler.make()));

/**
 * Run `start` inside a layer and hand back what it built.
 *
 * The capture is not a stylistic choice: `Layer.provide` refuses an async body
 * on this host, and every combinator here is CONSTRUCTED synchronously and
 * DRIVEN later, so the environment only has to be open across the
 * construction.
 */
const withRootCancellation = <T>(start: () => T): T => {
  let started!: T;
  Layer.provide(rootLayer(new Cancellation()), () => { started = start(); });
  return started;
};

/**
 * The same, providing only a `Scheduler`. These call sites pass their
 * cancellation explicitly, so they need the other half and nothing more.
 */
const withScheduler = <T>(start: () => T): T => {
  let started!: T;
  Layer.provide(Layer.succeed(Scheduler, HostScheduler.make()), () => { started = start(); });
  return started;
};

const unhandledRejections: unknown[] = [];
const recordUnhandled = (reason: unknown) => { unhandledRejections.push(reason); };
const rejectionEvents = process as unknown as {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

beforeAll(() => {
  rejectionEvents.on("unhandledRejection", recordUnhandled);
});

afterAll(async () => {
  await Bun.sleep(0);
  rejectionEvents.off("unhandledRejection", recordUnhandled);
  expect(unhandledRejections).toEqual([]);
});

describe("Stream", () => {
  test("map/filter/take/drop/scan compose as lazy sequence laws", async () => {
    const source = Stream.of(1, 2, 3, 4, 5);
    const transformed = source
      .drop(1)
      .take(3)
      .filter((value) => value % 2 === 0)
      .map((value) => value * 10)
      .scan(0, (sum, value) => sum + value);
    const values = (await transformed.runCollect()).unwrap();
    expect(values).toEqual([20, 60]);
    expect(Object.isFrozen(values)).toBe(true);

    expect((await source.take(0).runCollect()).unwrap()).toEqual([]);
    expect((await source.drop(99).runCollect()).unwrap()).toEqual([]);
  });

  test("creates a fresh iterator for each collection", async () => {
    const stream = Stream.fromIterable([1, 2, 3]);
    const [left, right] = await Promise.all([stream.runCollect(), stream.runCollect()]);
    expect(left.unwrap()).toEqual([1, 2, 3]);
    expect(right.unwrap()).toEqual([1, 2, 3]);
  });

  test("producer failures become expected Result errors", async () => {
    class ProducerFailed extends Error {}
    const failure = new ProducerFailed("source failed");
    async function* values() {
      yield 1;
      throw failure;
    }
    const result = __vsInspectResult(await Stream.fromAsyncIterable<number, ProducerFailed>(values()).runCollect());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(failure);
  });

  test("foreign non-Error throws are contained as UnhandledException", async () => {
    const hostile: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return { next: async () => { throw "not an Error"; } };
      },
    };
    const result = __vsInspectResult(await Stream.fromAsyncIterable(hostile).runCollect());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UnhandledException);
      expect((result.error as UnhandledException).thrown).toBe("not an Error");
    }
  });

  test("mapConcurrent delegates to governed unordered work and proves its bound", async () => {
    const governor = Governor.withLimit(2);
    let active = 0;
    let peak = 0;
    const result = await withRootCancellation(() => Stream.of(5, 1, 3, 2).mapConcurrent(async (delay) => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(delay);
      active -= 1;
      return delay;
    }, governor).runCollect());
    expect([...result.unwrap()].sort((left, right) => left - right)).toEqual([1, 2, 3, 5]);
    expect(peak).toBe(2);
    expect(governor.activeCount).toBe(0);
  });

  test("early mapConcurrent break cancels and joins in-flight work", async () => {
    let started = 0;
    let releaseStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => { releaseStarted = resolve; });
    let siblingJoined = false;
    const mapped = Stream.of(1, 2).mapConcurrent(async (value, cancellation) => {
      started += 1;
      if (started === 2) releaseStarted();
      await bothStarted;
      if (value === 1) return value;
      await cancellation.whenCancelled();
      await Bun.sleep(3);
      siblingJoined = true;
      throw new Cancelled("sibling stopped");
    }, 2);

    await withRootCancellation(async () => {
      for await (const value of mapped) {
        expect(value).toBe(1);
        break;
      }
    });
    expect(siblingJoined).toBe(true);
  });

  test("buffer uses bounded Queue storage, preserves order, and reports source failures", async () => {
    async function* values() {
      yield 1;
      await Bun.sleep(1);
      yield 2;
      yield 3;
    }
    const bounded = withScheduler(() => Stream.fromAsyncIterable(values()).buffer(1));
    expect((await bounded.runCollect()).unwrap()).toEqual([1, 2, 3]);

    const failure = new RangeError("buffer source failed");
    async function* failed() {
      yield 1;
      throw failure;
    }
    const failing = withScheduler(() => Stream.fromAsyncIterable(failed()).buffer(2));
    const result = __vsInspectResult(await failing.runCollect());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(failure);
  });

  test("buffer carries absent elements like every other operator", async () => {
    // buffer is the one operator that routes elements through a Queue. An
    // element must never vanish, or change the stream's failure channel,
    // because of its value.
    const absent: readonly (string | null | undefined)[] = ["a", undefined, null, "d"];
    const source = () => Stream.fromIterable<string | null | undefined>(absent);
    for (const build of [
      (stream: Stream<string | null | undefined>) => withScheduler(() => stream.buffer(1)),
      (stream: Stream<string | null | undefined>) => withScheduler(() => stream.buffer(4)),
      (stream: Stream<string | null | undefined>) => withScheduler(() => stream.map((value) => value).buffer(2)),
      (stream: Stream<string | null | undefined>) => withScheduler(() => stream.buffer(2).map((value) => value)),
    ]) {
      const result = __vsInspectResult(await build(source()).runCollect());
      expect(result.ok).toBe(true);
      if (result.ok) expect([...result.value]).toEqual([...absent]);
    }

    // Every lazy operator already agreed; keep them in the same assertion so a
    // future divergence is caught here rather than only in buffer.
    expect((await source().map((value) => value).runCollect()).unwrap()).toEqual([...absent]);
    expect((await source().filter(() => true).runCollect()).unwrap()).toEqual([...absent]);
    expect((await source().take(4).runCollect()).unwrap()).toEqual([...absent]);
    expect((await withRootCancellation(() => source().mapConcurrent(async (value) => value, 2).runCollect())).unwrap())
      .toEqual(expect.arrayContaining([...absent]));
  });

  test("early buffered break closes its source and waits for return cleanup", async () => {
    let nextValue = 0;
    let cleanupJoined = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            nextValue += 1;
            return { done: false as const, value: nextValue };
          },
          async return() {
            await Bun.sleep(4);
            cleanupJoined = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };

    for await (const value of withScheduler(() => Stream.fromAsyncIterable(source).buffer(1))) {
      expect(value).toBe(1);
      break;
    }
    expect(cleanupJoined).toBe(true);
  });

  test("runner cancellation is a typed failure and closes a pending source pull", async () => {
    let closed = false;
    const hanging: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => {}),
          async return() {
            closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const cancellation = new CancellationSource();
    const running = withScheduler(() => Stream.fromAsyncIterable(hanging).runCollect(cancellation));
    cancellation.cancel("stop stream");
    const result = __vsInspectResult(await running);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(Cancelled);
    expect(closed).toBe(true);
  });

  test("runForEach and runFold await consumer work", async () => {
    const seen: number[] = [];
    const each = await Stream.of(1, 2, 3).runForEach(async (value) => {
      await Bun.sleep(1);
      seen.push(value);
    });
    expect(each.isOk()).toBe(true);
    expect(seen).toEqual([1, 2, 3]);
    expect((await Stream.of(1, 2, 3).runFold(0, (sum, value) => sum + value)).unwrap()).toBe(6);
  });

  test("Stream values are frozen, branded, and non-forgeable", () => {
    const stream = Stream.of(1);
    expect(Object.isFrozen(stream)).toBe(true);
    expect(isStream(stream)).toBe(true);
    const forged = Object.create(Stream.prototype) as Stream<number>;
    expect(isStream(forged)).toBe(false);
    expect(() => forged[Symbol.asyncIterator]()).toThrow("forged Stream");
  });
});

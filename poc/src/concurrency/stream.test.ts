import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { UnhandledException, __vsInspectResult } from "../runtime/index.ts";
import {
  CancellationSource,
  Cancelled,
  Governor,
  Stream,
  isStream,
} from "./index.ts";

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
    const result = await Stream.of(5, 1, 3, 2).mapConcurrent(async (delay) => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(delay);
      active -= 1;
      return delay;
    }, governor).runCollect();
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

    for await (const value of mapped) {
      expect(value).toBe(1);
      break;
    }
    expect(siblingJoined).toBe(true);
  });

  test("buffer uses bounded Queue storage, preserves order, and reports source failures", async () => {
    async function* values() {
      yield 1;
      await Bun.sleep(1);
      yield 2;
      yield 3;
    }
    expect((await Stream.fromAsyncIterable(values()).buffer(1).runCollect()).unwrap()).toEqual([1, 2, 3]);

    const failure = new RangeError("buffer source failed");
    async function* failed() {
      yield 1;
      throw failure;
    }
    const result = __vsInspectResult(await Stream.fromAsyncIterable(failed()).buffer(2).runCollect());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(failure);
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

    for await (const value of Stream.fromAsyncIterable(source).buffer(1)) {
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
    const running = Stream.fromAsyncIterable(hanging).runCollect(cancellation);
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

import { describe, expect, test } from "bun:test";
import { bufferedUnordered, filterUnordered, mapUnordered } from "./index.ts";
import { Governor } from "./governor.ts";
import { Cancellation, Cancelled } from "./join.ts";
import { Layer } from "../runtime/layer.ts";
import { HostScheduler, Scheduler } from "./scheduler.ts";

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
  const output: Value[] = [];
  for await (const value of values) output.push(value);
  return output;
}

async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !predicate(); turn++) await Promise.resolve();
  if (!predicate()) throw new Error("condition did not become true");
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

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

describe("unordered async iterator helpers", () => {
  test("a shared Governor bounds mapUnordered fan-out across iterators", async () => {
    const governor = Governor.withLimit(2);
    let active = 0;
    let peak = 0;
    const mapper = async (value: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(3);
      active -= 1;
      return value;
    };

    const [left, right] = await Promise.all([
      collect(withRootCancellation(() => mapUnordered([1, 2, 3], mapper, governor))),
      collect(withRootCancellation(() => mapUnordered([4, 5, 6], mapper, governor))),
    ]);

    expect([...left, ...right].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(2);
    expect(governor.activeCount).toBe(0);
  });

  test("filterUnordered applies its predicate concurrently and yields passing completion order", async () => {
    const delays = new Map([[1, 12], [2, 1], [3, 3], [4, 1]]);
    const output = await collect(withRootCancellation(() => filterUnordered([1, 2, 3, 4], async (value) => {
      await Bun.sleep(delays.get(value)!);
      return value % 2 === 1;
    }, 2)));

    expect(output).toEqual([3, 1]);
  });

  test("bufferedUnordered keeps bounded pulls active and yields pull completion order", async () => {
    const pulls: Deferred<IteratorResult<number>>[] = [];
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            const pull = deferred<IteratorResult<number>>();
            pulls.push(pull);
            return pull.promise;
          },
        };
      },
    };
    const iterator = withRootCancellation(() => bufferedUnordered(source, 2));
    const first = iterator.next();
    await until(() => pulls.length === 2);
    pulls[1]!.resolve({ done: false, value: 20 });
    expect(await first).toEqual({ done: false, value: 20 });

    const second = iterator.next();
    await until(() => pulls.length === 3);
    pulls[2]!.resolve({ done: true, value: undefined });
    pulls[0]!.resolve({ done: false, value: 10 });
    expect(await second).toEqual({ done: false, value: 10 });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(pulls.length).toBe(3);
  });

  test("early buffered exit closes its source and joins every pending pull", async () => {
    const pending = new Set<Deferred<IteratorResult<number>>>();
    let pullsStarted = 0;
    let pullsFinished = 0;
    let sourceClosed = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            pullsStarted += 1;
            if (pullsStarted === 1) return Promise.resolve({ done: false, value: 1 });
            const pull = deferred<IteratorResult<number>>();
            pending.add(pull);
            return pull.promise.finally(() => {
              pullsFinished += 1;
              pending.delete(pull);
            });
          },
          async return() {
            sourceClosed = true;
            for (const pull of [...pending]) pull.resolve({ done: true, value: undefined });
            return { done: true, value: undefined };
          },
        };
      },
    };

    for await (const value of withRootCancellation(() => bufferedUnordered(source, 3))) {
      expect(value).toBe(1);
      break;
    }

    expect(sourceClosed).toBe(true);
    expect(pullsStarted).toBe(4);
    expect(pullsFinished).toBe(3);
    expect(pending.size).toBe(0);
  });

  test("mapUnordered reports its first mapper error only after joining siblings", async () => {
    const firstFailure = new RangeError("first mapper failure");
    let bothStarted!: () => void;
    const started = new Promise<void>((resolve) => { bothStarted = resolve; });
    let count = 0;
    let siblingJoined = false;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        const iterator = [1, 2][Symbol.iterator]();
        return {
          next: () => iterator.next(),
          return() { throw new Error("cleanup must not replace mapper failure"); },
        };
      },
    };

    const operation = collect(withRootCancellation(() => mapUnordered(source, 2, async (value, cancellation) => {
      count += 1;
      if (count === 2) bothStarted();
      await started;
      if (value === 1) throw firstFailure;
      const cancelled = await cancellation.whenCancelled();
      expect(cancelled).toBeInstanceOf(Cancelled);
      siblingJoined = true;
      throw new Error("later sibling failure");
    })));

    await expect(operation).rejects.toBe(firstFailure);
    expect(siblingJoined).toBe(true);
  });

  test("remembers temporal mapper failure order while the consumer is paused", async () => {
    const firstInTime = new Error("failed first in time");
    const laterLowerToken = new Error("failed later with a lower token");
    const releaseFirst = deferred<void>();
    const releaseLater = deferred<void>();
    const allStarted = deferred<void>();
    let started = 0;
    const iterator = withRootCancellation(() => mapUnordered([0, 1, 2], 3, async (value) => {
      started += 1;
      if (started === 3) allStarted.resolve();
      if (value === 0) {
        await allStarted.promise;
        return "initial";
      }
      if (value === 1) {
        await releaseLater.promise;
        throw laterLowerToken;
      }
      await releaseFirst.promise;
      throw firstInTime;
    }));

    expect(await iterator.next()).toEqual({ done: false, value: "initial" });
    releaseFirst.resolve();
    await Bun.sleep(0);
    releaseLater.resolve();
    await Bun.sleep(0);

    await expect(iterator.next()).rejects.toBe(firstInTime);
  });

  test("filter mapper failure triggers inherited cancellation and cleanup", async () => {
    const failure = new TypeError("predicate failed");
    let closed = false;
    async function* source() {
      try {
        yield 1;
        yield 2;
      } finally {
        closed = true;
      }
    }

    await expect(collect(withRootCancellation(() => filterUnordered(source(), async (value) => {
      if (value === 1) throw failure;
      await Bun.sleep(20);
      return true;
    }, 2)))).rejects.toBe(failure);
    expect(closed).toBe(true);
  });
});

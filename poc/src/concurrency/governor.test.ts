import { describe, expect, test } from "bun:test";
import { Cancelled } from "./join.ts";
import { Governor } from "./governor.ts";

describe("concurrency Governor", () => {
  test("bounds fan-out and releases slots after every operation", async () => {
    const governor = Governor.withLimit(2);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 8 }, (_, value) => governor.run(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(2);
      active -= 1;
      return value;
    }));

    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(2);
    expect(governor.activeCount).toBe(0);
    expect(governor.pendingCount).toBe(0);
  });

  test("admits queued operations in FIFO order", async () => {
    const governor = Governor.withLimit(1);
    const held = await governor.acquire();
    const order: number[] = [];
    const queued = [1, 2, 3].map((value) => governor.run(() => { order.push(value); }));
    await Promise.resolve();
    expect(governor.pendingCount).toBe(3);

    held.release();
    await Promise.all(queued);
    expect(order).toEqual([1, 2, 3]);
  });

  test("permit release is idempotent and cannot inflate capacity", async () => {
    const governor = Governor.withLimit(1);
    const first = await governor.acquire();
    const secondPromise = governor.acquire();
    first.release();
    first.release();
    const second = await secondPromise;

    expect(governor.activeCount).toBe(1);
    expect(governor.pendingCount).toBe(0);
    second.release();
    expect(governor.activeCount).toBe(0);
  });

  test("passes cancellation and ordinary failures through by identity", async () => {
    const governor = Governor.withLimit(1);
    const cancellation = new Cancelled("stop exactly");
    const failure = new RangeError("failure exactly");

    await expect(governor.run(() => { throw cancellation; })).rejects.toBe(cancellation);
    await expect(governor.run(async () => { throw failure; })).rejects.toBe(failure);
    expect(await governor.run(() => "slot recovered")).toBe("slot recovered");
  });

  test("synchronous reentrant enqueueing waits without recursive bookkeeping", async () => {
    const governor = Governor.withLimit(1);
    const events: string[] = [];
    let nested!: Promise<void>;

    await governor.run(() => {
      events.push("outer-start");
      nested = governor.run(() => { events.push("nested"); });
      events.push("outer-end");
    });
    await nested;

    expect(events).toEqual(["outer-start", "outer-end", "nested"]);
    expect(governor.activeCount).toBe(0);
  });

  test("contains an abandoned operation rejection without changing the returned Promise", async () => {
    const governor = Governor.withLimit(1);
    const abandoned = new Error("abandoned governor operation");
    let observedUnhandled = false;
    const observe = (reason: unknown) => {
      if (reason === abandoned) observedUnhandled = true;
    };
    const rejectionEvents = process as unknown as {
      on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
      off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
    };
    rejectionEvents.on("unhandledRejection", observe);
    try {
      void governor.run(() => { throw abandoned; });
      await Bun.sleep(5);
    } finally {
      rejectionEvents.off("unhandledRejection", observe);
    }
    expect(observedUnhandled).toBe(false);
    expect(governor.activeCount).toBe(0);
  });

  test("rejects unusable limits and invalid run callbacks", async () => {
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(() => Governor.withLimit(invalid)).toThrow("positive safe integer");
    }
    const governor = Governor.withLimit(1);
    await expect(governor.run(null as never)).rejects.toThrow("requires a function");
    expect(governor.activeCount).toBe(0);
  });
});

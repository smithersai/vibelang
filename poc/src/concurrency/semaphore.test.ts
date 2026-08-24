import { describe, expect, test } from "bun:test";
import {
  CancellationSource,
  Cancelled,
  Semaphore,
  SemaphorePermit,
  isSemaphore,
  isSemaphorePermit,
} from "./index.ts";

describe("Semaphore", () => {
  test("admits queued acquirers in strict FIFO order", async () => {
    const semaphore = new Semaphore(1);
    const first = await semaphore.acquire();
    const order: number[] = [];
    const waiting = [1, 2, 3].map(async (number) => {
      const permit = await semaphore.acquire();
      order.push(number);
      permit.release();
    });
    expect(semaphore.pendingCount).toBe(3);
    first.release();
    await Promise.all(waiting);
    expect(order).toEqual([1, 2, 3]);
    expect(semaphore.activeCount).toBe(0);
  });

  test("tryAcquire returns a branded permit only when a slot is immediately available", () => {
    const semaphore = Semaphore.withPermits(1);
    // Absence is `undefined`, read by ordinary narrowing.
    const acquired = semaphore.tryAcquire();
    expect(acquired).not.toBeUndefined();
    if (acquired === undefined) throw new Error("expected permit");
    expect(isSemaphorePermit(acquired)).toBe(true);
    expect(Object.isFrozen(acquired)).toBe(true);
    expect(semaphore.tryAcquire()).toBeUndefined();
    // `?.` and `??` read the absent case exactly as TypeScript does.
    expect(semaphore.tryAcquire()?.release).toBeUndefined();
    expect(semaphore.tryAcquire() ?? "none").toBe("none");
    acquired.release();
    acquired.release();
    expect(semaphore.availableCount).toBe(1);
  });

  test("cancelled waiters reject with Cancelled, lose their slot, and do not block followers", async () => {
    const semaphore = new Semaphore(1);
    const held = await semaphore.acquire();
    const cancellation = new CancellationSource();
    let observed = 0;
    cancellation.onCancel(() => { observed += 1; });
    const cancelled = semaphore.acquire(cancellation);
    const follower = semaphore.acquire();
    expect(semaphore.pendingCount).toBe(2);

    cancellation.cancel("leave line");
    await expect(cancelled).rejects.toBeInstanceOf(Cancelled);
    expect(semaphore.pendingCount).toBe(1);
    expect(observed).toBe(1);
    held.release();
    const next = await follower;
    next.release();
    expect(semaphore.activeCount).toBe(0);
  });

  test("accepts AbortSignal cancellation", async () => {
    const semaphore = new Semaphore(1);
    const held = await semaphore.acquire();
    const controller = new AbortController();
    const waiting = semaphore.acquire({ cancellation: controller.signal });
    controller.abort("abort waiter");
    await expect(waiting).rejects.toThrow("abort waiter");
    held.release();
    expect(semaphore.pendingCount).toBe(0);
  });

  test("withPermit releases after fulfillment and rejection while bounding work", async () => {
    const semaphore = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all([1, 2, 3, 4].map((value) => semaphore.withPermit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(2);
      active -= 1;
      if (value === 4) throw new RangeError("expected failure");
    }).catch((error) => {
      expect(error).toBeInstanceOf(RangeError);
    })));
    expect(peak).toBe(2);
    expect(semaphore.activeCount).toBe(0);
  });

  test("semaphores and permits reject structural forgeries", () => {
    const forgedSemaphore = Object.create(Semaphore.prototype) as Semaphore;
    expect(isSemaphore(forgedSemaphore)).toBe(false);
    expect(() => forgedSemaphore.tryAcquire()).toThrow("forged Semaphore");

    const forgedPermit = Object.create(SemaphorePermit.prototype) as SemaphorePermit;
    expect(isSemaphorePermit(forgedPermit)).toBe(false);
    expect(() => forgedPermit.release()).toThrow("forged SemaphorePermit");
  });
});

import { describe, expect, test } from "bun:test";
import { __vsInspectOptional, __vsInspectResult, decodeError, encodeError } from "../runtime/index.ts";
import { CancellationSource, Cancelled, Queue, QueueClosed, isQueue } from "./index.ts";

async function takeValue<Value>(queue: Queue<Value>): Promise<Value> {
  return (await queue.take()).unwrap();
}

describe("Queue", () => {
  test("requires an explicit positive bound and rejects structural forgeries", () => {
    expect(() => new Queue(0)).toThrow("positive safe integer");
    expect(() => new Queue(Number.POSITIVE_INFINITY)).toThrow("positive safe integer");
    const forged = Object.create(Queue.prototype) as Queue<number>;
    expect(isQueue(forged)).toBe(false);
    expect(() => forged.tryTake()).toThrow("forged Queue");
  });

  test("suspends producers when full and wakes them in FIFO order", async () => {
    const queue = new Queue<number>(1);
    await queue.offer(0);
    const completed: number[] = [];
    const first = queue.offer(1).then((result) => { result.unwrap(); completed.push(1); });
    const second = queue.offer(2).then((result) => { result.unwrap(); completed.push(2); });
    expect(queue.pendingOfferers).toBe(2);

    expect(await takeValue(queue)).toBe(0);
    await first;
    expect(completed).toEqual([1]);
    expect(await takeValue(queue)).toBe(1);
    await second;
    expect(completed).toEqual([1, 2]);
    expect(await takeValue(queue)).toBe(2);
  });

  test("suspends consumers when empty and wakes them in FIFO order", async () => {
    const queue = new Queue<number>(2);
    const order: number[] = [];
    const first = queue.take().then((result) => { order.push(result.unwrap()); });
    const second = queue.take().then((result) => { order.push(result.unwrap()); });
    expect(queue.pendingTakers).toBe(2);
    await queue.offer(10);
    await queue.offer(20);
    await Promise.all([first, second]);
    expect(order).toEqual([10, 20]);
  });

  test("shutdown settles pending takers and offerers and drains accepted items", async () => {
    const empty = new Queue<number>(1);
    const pendingTake = empty.take();
    expect(empty.shutdown("input ended")).toBe(true);
    expect(empty.shutdown("again")).toBe(false);
    const taken = __vsInspectResult(await pendingTake);
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.error).toBeInstanceOf(QueueClosed);

    const full = new Queue<number>(1);
    await full.offer(1);
    const pendingOffer = full.offer(2);
    full.shutdown("output ended");
    expect((await pendingOffer).isError()).toBe(true);
    expect(await takeValue(full)).toBe(1);
    expect((await full.take()).unwrapOr((error) => error)).toBeInstanceOf(QueueClosed);
  });

  test("cancellation removes suspended waiters without leaking capacity", async () => {
    const queue = new Queue<number>(1);
    await queue.offer(1);
    const cancellation = new CancellationSource();
    let handlers = 0;
    cancellation.onCancel(() => { handlers += 1; });
    const waiting = queue.offer(2, { cancellation });
    expect(queue.pendingOfferers).toBe(1);
    cancellation.cancel("producer left");
    const result = __vsInspectResult(await waiting);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(Cancelled);
    expect(queue.pendingOfferers).toBe(0);
    expect(handlers).toBe(1);
    expect(await takeValue(queue)).toBe(1);
    expect((await queue.offer(3)).isOk()).toBe(true);

    const takerCancellation = new CancellationSource();
    const empty = new Queue<number>(1);
    const taking = empty.take(takerCancellation);
    takerCancellation.cancel("consumer left");
    expect((await taking).isError()).toBe(true);
    expect(empty.pendingTakers).toBe(0);
    await empty.offer(4);
    expect(await takeValue(empty)).toBe(4);
  });

  test("try operations distinguish temporary misses from permanent closure", () => {
    const queue = new Queue<number>(1);
    expect(__vsInspectOptional(queue.tryTake()).some).toBe(false);
    const offered = __vsInspectOptional(queue.tryOffer(1));
    expect(offered.some).toBe(true);
    if (offered.some) expect(offered.value.isOk()).toBe(true);
    expect(__vsInspectOptional(queue.tryOffer(2)).some).toBe(false);
    const taken = __vsInspectOptional(queue.tryTake());
    expect(taken.some).toBe(true);
    if (taken.some) expect(taken.value.unwrap()).toBe(1);
    queue.shutdown();
    const closed = __vsInspectOptional(queue.tryTake());
    expect(closed.some).toBe(true);
    if (closed.some) expect(closed.value.isError()).toBe(true);
  });

  test("QueueClosed is nominal and wire round-trips", () => {
    const decoded = decodeError(encodeError(new QueueClosed("wire close")));
    expect(decoded).toBeInstanceOf(QueueClosed);
    expect(decoded.message).toBe("wire close");
    expect(new QueueClosed().is(Cancelled)).toBe(false);
  });
});

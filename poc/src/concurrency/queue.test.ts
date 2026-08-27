import { describe, expect, test } from "bun:test";
import { __vsInspectResult, decodeError, encodeError } from "../runtime/index.ts";
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
    // A temporary miss is `undefined`; a permanent closure is a Result error.
    // The two stay distinguishable without a container.
    expect(queue.tryTake()).toBeUndefined();
    const offered = queue.tryOffer(1);
    expect(offered).not.toBeUndefined();
    expect(offered?.isOk()).toBe(true);
    expect(queue.tryOffer(2)).toBeUndefined();
    const taken = queue.tryTake();
    if (taken === undefined) throw new Error("expected a value");
    expect(taken.unwrap()).toBe(1);
    queue.shutdown();
    const closed = queue.tryTake();
    expect(closed).not.toBeUndefined();
    expect(closed?.isError()).toBe(true);
  });

  test("carries null and undefined as ordinary elements", async () => {
    // The try-operations tag their outcome, so emptiness is never confused with
    // an element that happens to be absent. Absence must therefore stay inside
    // the element type instead of being encoded out of it.
    const queue = new Queue<string | null | undefined>(3);
    expect((await queue.offer("x")).isOk()).toBe(true);
    expect((await queue.offer(undefined)).isOk()).toBe(true);
    expect((await queue.offer(null)).isOk()).toBe(true);
    expect(queue.size).toBe(3);
    expect(await takeValue(queue)).toBe("x");
    expect(await takeValue(queue)).toBeUndefined();
    expect(await takeValue(queue)).toBeNull();
    expect(queue.size).toBe(0);

    // A present `undefined` still reads back as a Result, so the outer
    // `undefined` keeps meaning "empty right now" and nothing else.
    expect(queue.tryTake()).toBeUndefined();
    expect(queue.tryOffer(undefined)?.isOk()).toBe(true);
    const taken = queue.tryTake();
    if (taken === undefined) throw new Error("a buffered undefined must read back as a Result");
    expect(taken.unwrap()).toBeUndefined();

    const handoff = new Queue<undefined>(1);
    const waiting = handoff.take();
    await handoff.offer(undefined);
    expect((await waiting).unwrap()).toBeUndefined();
  });

  test("take observes an already-cancelled token before draining a buffered value", async () => {
    const queue = new Queue<number>(2);
    await queue.offer(1);
    const cancellation = new CancellationSource();
    cancellation.cancel("consumer left");

    const result = __vsInspectResult(await queue.take(cancellation));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(Cancelled);
    // The value must not have been consumed on the cancelled caller's behalf.
    expect(queue.size).toBe(1);
    expect(await takeValue(queue)).toBe(1);

    // Its sibling already behaved this way, and both stay usable uncancelled.
    const live = new CancellationSource();
    expect((await queue.offer(2, live)).isOk()).toBe(true);
    expect((await queue.take(live)).unwrap()).toBe(2);
  });

  test("shutdown drain and closed refusal keep their precedence over cancellation", async () => {
    const drained = new Queue<number>(2);
    await drained.offer(1);
    drained.shutdown("bye");
    // Documented: shutdown lets accepted buffered values drain.
    expect(await takeValue(drained)).toBe(1);
    expect((await drained.take()).unwrapOr((error) => error)).toBeInstanceOf(QueueClosed);

    const cancellation = new CancellationSource();
    cancellation.cancel("consumer left");
    const empty = new Queue<number>(1);
    empty.shutdown("bye");
    // Closed-with-nothing-to-drain is the refusal this Queue can never take
    // back, so it outranks the cancellation checkpoint on both halves.
    expect((await empty.take(cancellation)).unwrapOr((error) => error)).toBeInstanceOf(QueueClosed);
    expect((await empty.offer(1, cancellation)).unwrapOr((error) => error)).toBeInstanceOf(QueueClosed);
  });

  test("QueueClosed is nominal and wire round-trips", () => {
    const decoded = decodeError(encodeError(new QueueClosed("wire close")));
    expect(decoded).toBeInstanceOf(QueueClosed);
    expect(decoded.message).toBe("wire close");
    expect(new QueueClosed().is(Cancelled)).toBe(false);
  });
});

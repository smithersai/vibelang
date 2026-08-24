import { describe, expect, test } from "bun:test";
import { __vsInspectResult } from "../runtime/index.ts";
import { CancellationSource, Channel, QueueClosed, isChannel } from "./index.ts";

describe("Channel", () => {
  test("coordinates multiple senders and receivers over its bounded queue", async () => {
    const channel = new Channel<number>(1);
    const values: number[] = [];
    const consumer = (async () => {
      values.push((await channel.receive()).unwrap());
      values.push((await channel.receive()).unwrap());
      values.push((await channel.receive()).unwrap());
    })();
    await Promise.all([channel.send(1), channel.send(2), channel.send(3)]);
    await consumer;
    expect(values).toEqual([1, 2, 3]);
    expect(channel.size).toBe(0);
  });

  test("async iteration drains accepted values and terminates cleanly on close", async () => {
    const channel = Channel.buffered<string>(2);
    await channel.send("a");
    await channel.send("b");
    channel.close("done");
    const values: string[] = [];
    for await (const value of channel) values.push(value);
    expect(values).toEqual(["a", "b"]);
  });

  test("close propagates QueueClosed to suspended send and receive operations", async () => {
    const receiving = new Channel<number>(1);
    const receive = receiving.receive();
    receiving.close("receive close");
    const receiveResult = __vsInspectResult(await receive);
    expect(receiveResult.ok).toBe(false);
    if (!receiveResult.ok) expect(receiveResult.error).toBeInstanceOf(QueueClosed);

    const sending = new Channel<number>(1);
    await sending.send(1);
    const send = sending.send(2);
    sending.close("send close");
    const sendResult = __vsInspectResult(await send);
    expect(sendResult.ok).toBe(false);
    if (!sendResult.ok) expect(sendResult.error).toBeInstanceOf(QueueClosed);
  });

  test("receive cancellation removes the pending receiver", async () => {
    const channel = new Channel<number>();
    const cancellation = new CancellationSource();
    const pending = channel.receive(cancellation);
    expect(channel.pendingReceivers).toBe(1);
    cancellation.cancel("leave channel");
    expect((await pending).isError()).toBe(true);
    expect(channel.pendingReceivers).toBe(0);
    expect((await channel.send(7)).isOk()).toBe(true);
  });

  test("try operations expose backpressure as `undefined`", () => {
    const channel = new Channel<number>(1);
    expect(channel.tryReceive()).toBeUndefined();
    expect(channel.trySend(1)).not.toBeUndefined();
    expect(channel.trySend(2)).toBeUndefined();
    const received = channel.tryReceive();
    expect(received).not.toBeUndefined();
    if (received === undefined) throw new Error("expected a value");
    expect(received.unwrap()).toBe(1);
    // A backpressured attempt reads with `?.`/`??` like any nullish value.
    expect(channel.tryReceive()?.isOk()).toBeUndefined();
    expect(channel.tryReceive() ?? "empty").toBe("empty");
  });

  test("channels are frozen and reject structural forgeries", () => {
    const channel = new Channel<number>();
    expect(Object.isFrozen(channel)).toBe(true);
    expect(isChannel(channel)).toBe(true);
    const forged = Object.create(Channel.prototype) as Channel<number>;
    expect(isChannel(forged)).toBe(false);
    expect(() => forged.close()).toThrow("forged Channel");
  });
});

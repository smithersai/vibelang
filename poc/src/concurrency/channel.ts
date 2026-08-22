import { __vsInspectResult } from "../runtime/index.ts";
import {
  Queue,
  QueueClosed,
  type QueueCancellation,
  type QueueResult,
  type QueueTryResult,
} from "./queue.ts";

interface ChannelState<Value> {
  readonly queue: Queue<Value>;
}

const channelStates = new WeakMap<object, ChannelState<any>>();
const localChannels = new WeakSet<object>();

function stateOf<Value>(channel: Channel<Value>): ChannelState<Value> {
  const state = channelStates.get(channel);
  if (!state || !localChannels.has(channel)) throw new TypeError("forged Channel value");
  return state as ChannelState<Value>;
}

/**
 * A closeable small-buffer channel. It is an MPMC façade over Queue whose
 * async iterator treats QueueClosed as normal end-of-stream.
 */
export class Channel<Value> implements AsyncIterable<Value> {
  constructor(capacity = 1) {
    channelStates.set(this, { queue: new Queue<Value>(capacity) });
    localChannels.add(this);
    Object.freeze(this);
  }

  static buffered<Value>(capacity: number): Channel<Value> {
    return new Channel<Value>(capacity);
  }

  static isChannel(value: unknown): value is Channel<unknown> {
    return typeof value === "object" && value !== null && localChannels.has(value);
  }

  get capacity(): number { return stateOf(this).queue.capacity; }
  get size(): number { return stateOf(this).queue.size; }
  get pendingReceivers(): number { return stateOf(this).queue.pendingTakers; }
  get pendingSenders(): number { return stateOf(this).queue.pendingOfferers; }
  get isClosed(): boolean { return stateOf(this).queue.isShutdown; }

  send(value: Value, options?: QueueCancellation): Promise<QueueResult<void>> {
    return stateOf(this).queue.offer(value, options);
  }

  trySend(value: Value): QueueTryResult<void> {
    return stateOf(this).queue.tryOffer(value);
  }

  receive(options?: QueueCancellation): Promise<QueueResult<Value>> {
    return stateOf(this).queue.take(options);
  }

  tryReceive(): QueueTryResult<Value> {
    return stateOf(this).queue.tryTake();
  }

  close(reason: unknown = "channel closed"): boolean {
    return stateOf(this).queue.shutdown(reason);
  }

  [Symbol.asyncIterator](): AsyncIterator<Value> {
    const queue = stateOf(this).queue;
    let done = false;
    return {
      async next(): Promise<IteratorResult<Value>> {
        if (done) return { done: true, value: undefined };
        const result = __vsInspectResult(await queue.take());
        if (result.ok) return { done: false, value: result.value };
        if (result.error instanceof QueueClosed) {
          done = true;
          return { done: true, value: undefined };
        }
        throw result.error;
      },
      async return(): Promise<IteratorResult<Value>> {
        done = true;
        return { done: true, value: undefined };
      },
    };
  }
}

export function isChannel(value: unknown): value is Channel<unknown> {
  return Channel.isChannel(value);
}

import { describe, expect, test } from "bun:test";
import { decodeError, encodeError, errorIs } from "../runtime/errors.ts";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { type Result, isResult } from "../runtime/result.ts";
import { NodePlatform, TestPlatform } from "./layers.ts";
import {
  AddressInUse,
  ConnectionClosed,
  ConnectionRefused,
  MemorySocket,
  NodeSocket,
  ReceiveBufferOverflow,
  Socket,
  type SocketConnection,
  SocketError,
  SocketFailure,
  SocketTimeout,
} from "./socket.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

function value<A>(result: Result<A, SocketError>): A {
  return result.match({
    ok: (ok) => ok,
    error: (error) => {
      throw error;
    },
  });
}

function failureOf<A>(result: Result<A, SocketError>): SocketError {
  return result.match({
    ok: (ok) => {
      throw new Error(`expected a failure, received ${String(ok)}`);
    },
    error: (error) => error,
  });
}

/**
 * The host's rejection hook, through a structural view: Bun's and Node's
 * `process` typings enumerate different event names, and this test only needs
 * these two functions.
 */
const rejectionHook = process as unknown as {
  on(event: string, listener: (reason: unknown) => void): unknown;
  off(event: string, listener: (reason: unknown) => void): unknown;
};

/** Collects accepted connections so a test can await the server side of a pair. */
function accepter() {
  const queue: SocketConnection[] = [];
  const waiters: Array<(connection: SocketConnection) => void> = [];
  return {
    handler: (connection: SocketConnection): void => {
      const waiter = waiters.shift();
      if (waiter === undefined) queue.push(connection);
      else waiter(connection);
    },
    next(): Promise<SocketConnection> {
      const ready = queue.shift();
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise<SocketConnection>((resolve) => waiters.push(resolve));
    },
  };
}

/** TCP is a byte stream: read until the expected number of bytes has arrived. */
async function readExactly(connection: SocketConnection, count: number): Promise<string> {
  const parts: Uint8Array[] = [];
  let total = 0;
  while (total < count) {
    const chunk = value(await connection.read());
    const bytes = chunk ?? new Uint8Array(0);
    if (bytes.length === 0) break;
    parts.push(bytes);
    total += bytes.length;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return decoder.decode(joined);
}

async function expectEndOfFile(connection: SocketConnection): Promise<void> {
  // End-of-file is an absent *success*: `undefined`, not a typed failure.
  const first = value(await connection.read());
  expect(first).toBeUndefined();
  expect(first?.length).toBeUndefined();
  // End-of-file is stable: reading again reports the same fact.
  const second = value(await connection.read());
  expect(second).toBeUndefined();
}

/** The contract every Socket implementation satisfies. */
async function assertSocketContract(socket: Socket): Promise<void> {
  const accepted = accepter();
  const listener = value(await socket.listen(0, accepted.handler));
  const address = listener.address();
  expect(address.port).toBeGreaterThan(0);
  expect(listener.closed).toBe(false);

  const client = value(await socket.connect(address.host, address.port));
  const server = await accepted.next();

  // Round trip in both directions.
  expect(value(await client.write(encoder.encode("ping")))).toBeUndefined();
  expect(await readExactly(server, 4)).toBe("ping");
  value(await server.write(encoder.encode("pong")));
  expect(await readExactly(client, 4)).toBe("pong");

  // Reads and writes are ordinary branded runtime values, not raw data.
  const pending = client.read();
  expect(panics(() => client.read())).toBe(true);
  value(await server.write(encoder.encode("x")));
  const settled = await pending;
  expect(isResult(settled)).toBe(true);
  expect(decoder.decode(value(settled) ?? new Uint8Array(0))).toBe("x");

  // A clean close is an absent read on the peer, not a failure.
  await client.close();
  expect(client.closed).toBe(true);
  await expectEndOfFile(server);

  // Writing to a closed connection is the nominal ConnectionClosed case.
  expect(errorIs(failureOf(await client.write(encoder.encode("late"))), ConnectionClosed)).toBe(true);
  expect(errorIs(failureOf(await server.write(encoder.encode("late"))), ConnectionClosed)).toBe(true);
  await server.close();
  // Closing twice is a no-op, not a second teardown.
  await client.close();

  // A second bind of the same address is refused rather than silently stealing it.
  const inUse = failureOf(await socket.listen(address.port, () => {}, { host: address.host }));
  expect(errorIs(inUse, AddressInUse)).toBe(true);

  await listener.close();
  expect(listener.closed).toBe(true);

  // Nothing is listening any more.
  const refused = failureOf(await socket.connect(address.host, address.port));
  expect(errorIs(refused, ConnectionRefused)).toBe(true);
  expect(errorIs(refused, SocketError)).toBe(true);

  // Unusable arguments are programming errors, not failures on the channel.
  expect(panics(() => socket.connect(address.host, -1))).toBe(true);
  expect(panics(() => socket.connect("", 80))).toBe(true);
  expect(panics(() => socket.listen(70_000, () => {}))).toBe(true);
  expect(panics(() => socket.listen(0, undefined as unknown as () => void))).toBe(true);
}

describe("Socket", () => {
  test("NodeSocket satisfies the contract over loopback", async () => {
    await assertSocketContract(NodeSocket.make());
  });

  test("MemorySocket satisfies the contract with no network at all", async () => {
    await assertSocketContract(MemorySocket.make());
  });

  test("a live listener binds loopback and reports the ephemeral port the host chose", async () => {
    const socket = NodeSocket.make();
    const listener = value(await socket.listen(0, () => {}));
    expect(listener.address().host).toBe("127.0.0.1");
    expect(listener.address().port).toBeGreaterThan(0);
    await listener.close();
  });

  test("a live connection reports its endpoints and survives a large round trip", async () => {
    const socket = NodeSocket.make();
    const accepted = accepter();
    const listener = value(await socket.listen(0, accepted.handler));
    const { host, port } = listener.address();
    const client = value(await socket.connect(host, port));
    const server = await accepted.next();

    expect(client.remote.port).toBe(port);
    expect(server.local.port).toBe(port);

    const payload = "smithers".repeat(4_096);
    value(await client.write(encoder.encode(payload)));
    expect(await readExactly(server, payload.length)).toBe(payload);

    await client.close();
    await server.close();
    await listener.close();
  });

  test("unread bytes past the cap fail the connection instead of growing the heap", async () => {
    for (const socket of [NodeSocket.make(), MemorySocket.make()] as const) {
      const accepted = accepter();
      const listener = value(await socket.listen(0, accepted.handler, { maxBufferedBytes: 64 }));
      const { host, port } = listener.address();
      const client = value(await socket.connect(host, port, { maxBufferedBytes: 64 }));
      const server = await accepted.next();

      // The reader never reads, so the unread bytes pass the cap.
      await client.write(encoder.encode("z".repeat(4_096)));
      let overflow: SocketError | undefined;
      for (let attempt = 0; attempt < 8 && overflow === undefined; attempt += 1) {
        const read = await server.read();
        overflow = read.match({
          ok: (): SocketError | undefined => undefined,
          error: (error) => error,
        });
      }
      expect(errorIs(overflow, ReceiveBufferOverflow)).toBe(true);
      expect(overflow?.message).toContain("64 bytes");

      await client.close();
      await server.close();
      await listener.close();
    }
  });

  test("destroying a live connection mid-read settles the read as a value", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    rejectionHook.on("unhandledRejection", onRejection);
    try {
      const socket = NodeSocket.make();
      const accepted = accepter();
      const listener = value(await socket.listen(0, accepted.handler));
      const { host, port } = listener.address();
      const client = value(await socket.connect(host, port));
      const server = await accepted.next();

      // A read is in flight when the peer disappears. It must settle as a
      // Result — either end-of-file or a SocketError — and the host's 'error'
      // event must never reach the process as unhandled.
      const pending = client.read();
      await server.close();
      const settled = await pending;
      expect(isResult(settled)).toBe(true);
      settled.match({
        ok: (chunk: Uint8Array | undefined) => expect(chunk).toBeUndefined(),
        error: (error) => expect(errorIs(error, SocketError)).toBe(true),
      });

      // Writing into the wreckage is a failure, never a throw.
      const late = await client.write(encoder.encode("after"));
      expect(isResult(late)).toBe(true);

      await client.close();
      await listener.close();
      await Promise.resolve();
      expect(rejections).toEqual([]);
    } finally {
      rejectionHook.off("unhandledRejection", onRejection);
    }
  });

  test("closing a live listener tears down what it accepted", async () => {
    const socket = NodeSocket.make();
    const accepted = accepter();
    const listener = value(await socket.listen(0, accepted.handler));
    const { host, port } = listener.address();
    const client = value(await socket.connect(host, port));
    const server = await accepted.next();

    const pending = server.read();
    await listener.close();
    // The accepted connection is gone, and its pending read settled rather than
    // hanging on a listener that no longer exists.
    expect(isResult(await pending)).toBe(true);
    // `close` is idempotent and resolves once the host has released the socket,
    // which is where `closed` becomes observable.
    await server.close();
    expect(server.closed).toBe(true);
    await client.close();
  });

  test("a live connection to a closed port is refused, not hung", async () => {
    const socket = NodeSocket.make();
    const listener = value(await socket.listen(0, () => {}));
    const { host, port } = listener.address();
    await listener.close();
    const refused = failureOf(await socket.connect(host, port, { timeoutMillis: 2_000 }));
    expect(errorIs(refused, ConnectionRefused)).toBe(true);
    expect(refused.endpoint).toBe(`${host}:${port}`);
  });

  test("MemorySocket routes by address and treats localhost as loopback", async () => {
    const socket = MemorySocket.make();
    const accepted = accepter();
    const listener = value(await socket.listen(0, accepted.handler));
    expect(socket.bound()).toEqual([`127.0.0.1:${listener.address().port}`]);

    const client = value(await socket.connect("localhost", listener.address().port));
    const server = await accepted.next();
    value(await client.write(encoder.encode("hello")));
    expect(await readExactly(server, 5)).toBe("hello");

    // A second listener gets its own ephemeral port.
    const other = value(await socket.listen(0, () => {}));
    expect(other.address().port).not.toBe(listener.address().port);
    expect(socket.bound()).toHaveLength(2);

    await listener.close();
    expect(socket.bound()).toEqual([`127.0.0.1:${other.address().port}`]);
    await other.close();
    expect(socket.bound()).toEqual([]);

    await client.close();
    await server.close();
  });

  test("socket errors are nominal and survive the wire codec", () => {
    const endpoint = "127.0.0.1:8080";
    for (
      const error of [
        new ConnectionRefused(endpoint),
        new ConnectionClosed(endpoint),
        new SocketTimeout(endpoint),
        new AddressInUse(endpoint),
        new ReceiveBufferOverflow(endpoint),
      ]
    ) {
      const decoded = decodeError(encodeError(error));
      expect(decoded.constructor).toBe(error.constructor);
      expect((decoded as SocketError).endpoint).toBe(endpoint);
      expect(decoded.message).toBe(error.message);
      expect(errorIs(decoded, SocketError)).toBe(true);
    }
    const failure = decodeError(encodeError(new SocketFailure(endpoint, "EHOSTUNREACH")));
    expect((failure as SocketFailure).code).toBe("EHOSTUNREACH");

    // Siblings are nominally distinct despite identical shapes.
    expect(errorIs(new ConnectionRefused(endpoint), ConnectionClosed)).toBe(false);
    expect(errorIs(new ConnectionClosed(endpoint), ConnectionRefused)).toBe(false);
  });

  test("Socket resolves through a Layer, and the bundles provide one", async () => {
    const double = MemorySocket.make();
    expect(Layer.provide(Layer.succeed(Socket, double), () => Socket.context())).toBe(double);
    expect(panics(() => Socket.context())).toBe(true);

    const platform = TestPlatform.make();
    const fromTest = Layer.provide(platform.layer, () => Socket.context());
    expect(fromTest).toBe(platform.socket);
    expect(fromTest).toBeInstanceOf(MemorySocket);
    expect(Layer.provide(NodePlatform, () => Socket.context())).toBeInstanceOf(NodeSocket);

    // The bundle's cap flows into every connection the double creates.
    const bounded = TestPlatform.make({ maxBufferedBytes: 8 });
    const accepted = accepter();
    const listener = value(await bounded.socket.listen(0, accepted.handler));
    const client = value(await bounded.socket.connect("127.0.0.1", listener.address().port));
    const server = await accepted.next();
    expect(errorIs(failureOf(await client.write(encoder.encode("too many bytes"))), ReceiveBufferOverflow)).toBe(true);
    expect(errorIs(failureOf(await server.read()), ReceiveBufferOverflow)).toBe(true);
    await listener.close();
  });

  test("a listener whose handler throws destroys the connection instead of crashing", async () => {
    const socket = MemorySocket.make();
    const listener = value(await socket.listen(0, () => {
      throw new Error("handler exploded");
    }));
    const client = value(await socket.connect("127.0.0.1", listener.address().port));
    // The client still gets a connection; it simply has no live peer.
    await expectEndOfFile(client);
    await client.close();
    await listener.close();
  });
});

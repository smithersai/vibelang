/**
 * `Socket`: bounded TCP.
 *
 * The surface is deliberately small — connect, write, read, close; listen,
 * address, close — because a stream API is where a capability library usually
 * grows an unbounded lifetime problem. Everything here is shaped to avoid that:
 *
 * - **Every event-path failure becomes a `Result`.** A `node:net` socket that
 *   emits `'error'` with no listener takes the process down. Both wrappers
 *   attach their handlers before the socket can emit anything, record the
 *   failure, and hand it to the next `read`/`write` — so a broken connection is
 *   a value in the `SocketError` channel, never an unhandled event and never an
 *   unhandled rejection.
 * - **Reading is byte-bounded.** A connection buffers at most
 *   `maxBufferedBytes` (1 MiB by default) of unread data. A peer that outruns
 *   the reader past that cap fails the connection with `ReceiveBufferOverflow`
 *   instead of growing the heap without limit: read promptly, or raise the cap.
 *   The cap is on *unread* bytes, so a reader that keeps up is never affected.
 * - **`read` is a byte-stream read, not a message read.** It returns whatever
 *   has arrived — one chunk, several coalesced, or part of one. TCP has no
 *   frames; a protocol on top of this must do its own framing.
 * - **Absence is end-of-file.** `read` yields `Optional` absent exactly once the
 *   peer has closed cleanly and every buffered byte has been handed over. An
 *   abrupt close is `ConnectionClosed`, which is a different fact.
 * - **`read` is not reentrant, and says so at the call site.** A second
 *   concurrent `read` panics synchronously rather than rejecting later, the way
 *   `TestSleeper.sleep` panics on a bad argument.
 * - **Loopback by default.** `listen` binds `127.0.0.1` unless a host is named,
 *   so a program does not accidentally expose a port to the network.
 * - **A listener owns what it accepts.** Closing one destroys the connections it
 *   accepted, so teardown is deterministic and a test cannot hang waiting for a
 *   peer that never closes.
 */

import * as net from "node:net";
import { type JsonValue, type NominalError, registerErrorCodec, registerErrorType } from "../runtime/errors.ts";
import { Context } from "../runtime/layer.ts";
import type { Optional } from "../runtime/optional.ts";
import { panic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { causeDetail, errnoCode } from "./internal.ts";

const { absent, failure, present, success } = RuntimeValues;

// ---------------------------------------------------------------------------
// Failure channel
// ---------------------------------------------------------------------------

/** Base of the socket failure channel; every case names the endpoint involved. */
export abstract class SocketError extends Error {
  constructor(
    readonly endpoint: string,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "SocketError";
  }
}

registerErrorType(SocketError, "vibelang:SocketError@1");

/** Nothing is listening at the endpoint. */
export class ConnectionRefused extends SocketError {
  constructor(endpoint: string, message = `Connection refused: ${endpoint}`, options?: { readonly cause?: unknown }) {
    super(endpoint, message, options);
    this.name = "ConnectionRefused";
  }
}
export interface ConnectionRefused extends NominalError<"vibelang:ConnectionRefused@1"> {}

/**
 * The connection is gone. Either it was closed abruptly (reset by the peer,
 * destroyed locally) or the operation was attempted after `close`. A *clean*
 * end-of-file is not this: it is an absent `read`.
 */
export class ConnectionClosed extends SocketError {
  constructor(endpoint: string, message = `Connection closed: ${endpoint}`, options?: { readonly cause?: unknown }) {
    super(endpoint, message, options);
    this.name = "ConnectionClosed";
  }
}
export interface ConnectionClosed extends NominalError<"vibelang:ConnectionClosed@1"> {}

export class SocketTimeout extends SocketError {
  constructor(endpoint: string, message = `Socket timed out: ${endpoint}`, options?: { readonly cause?: unknown }) {
    super(endpoint, message, options);
    this.name = "SocketTimeout";
  }
}
export interface SocketTimeout extends NominalError<"vibelang:SocketTimeout@1"> {}

export class AddressInUse extends SocketError {
  constructor(endpoint: string, message = `Address already in use: ${endpoint}`, options?: { readonly cause?: unknown }) {
    super(endpoint, message, options);
    this.name = "AddressInUse";
  }
}
export interface AddressInUse extends NominalError<"vibelang:AddressInUse@1"> {}

/** Unread data passed the connection's byte cap; the connection was destroyed. */
export class ReceiveBufferOverflow extends SocketError {
  constructor(
    endpoint: string,
    message = `Receive buffer overflowed: ${endpoint}`,
    options?: { readonly cause?: unknown },
  ) {
    super(endpoint, message, options);
    this.name = "ReceiveBufferOverflow";
  }
}
export interface ReceiveBufferOverflow extends NominalError<"vibelang:ReceiveBufferOverflow@1"> {}

/** Anything the host reported that has no dedicated nominal case; `code` keeps the errno. */
export class SocketFailure extends SocketError {
  constructor(
    endpoint: string,
    readonly code: string,
    message = `Socket operation failed (${code}): ${endpoint}`,
    options?: { readonly cause?: unknown },
  ) {
    super(endpoint, message, options);
    this.name = "SocketFailure";
  }
}
export interface SocketFailure extends NominalError<"vibelang:SocketFailure@1"> {}

function decodeEndpointPayload(payload: JsonValue): { readonly endpoint: string; readonly message: string } {
  if (
    payload === null || Array.isArray(payload) || typeof payload !== "object" ||
    Object.keys(payload).length !== 2 ||
    typeof payload.endpoint !== "string" || typeof payload.message !== "string"
  ) {
    throw new TypeError("invalid SocketError payload");
  }
  return { endpoint: payload.endpoint, message: payload.message };
}

type EndpointErrorConstructor = new (endpoint: string, message?: string) => SocketError;

const endpointErrors: ReadonlyArray<readonly [EndpointErrorConstructor, string]> = [
  [ConnectionRefused, "vibelang:ConnectionRefused@1"],
  [ConnectionClosed, "vibelang:ConnectionClosed@1"],
  [SocketTimeout, "vibelang:SocketTimeout@1"],
  [AddressInUse, "vibelang:AddressInUse@1"],
  [ReceiveBufferOverflow, "vibelang:ReceiveBufferOverflow@1"],
];

for (const [type, id] of endpointErrors) {
  registerErrorCodec(type, id, {
    encode: (error): JsonValue => ({ endpoint: error.endpoint, message: error.message }),
    decode: (payload) => {
      const { endpoint, message } = decodeEndpointPayload(payload);
      return new type(endpoint, message);
    },
  });
}

registerErrorCodec(SocketFailure, "vibelang:SocketFailure@1", {
  encode: (error): JsonValue => ({ endpoint: error.endpoint, code: error.code, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 3 ||
      typeof payload.endpoint !== "string" || typeof payload.code !== "string" ||
      typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid SocketFailure payload");
    }
    return new SocketFailure(payload.endpoint, payload.code, payload.message);
  },
});

/** Translate a foreign `node:net` failure into the nominal channel. */
export function toSocketError(endpoint: string, cause: unknown): SocketError {
  switch (errnoCode(cause)) {
    case "ECONNREFUSED":
      return new ConnectionRefused(endpoint, undefined, { cause });
    case "ECONNRESET":
    case "EPIPE":
    case "ERR_STREAM_DESTROYED":
    case "ERR_STREAM_WRITE_AFTER_END":
      return new ConnectionClosed(endpoint, `Connection closed: ${endpoint}: ${causeDetail(cause)}`, { cause });
    case "ETIMEDOUT":
      return new SocketTimeout(endpoint, undefined, { cause });
    case "EADDRINUSE":
      return new AddressInUse(endpoint, undefined, { cause });
    default: {
      const code = errnoCode(cause) ?? "UNKNOWN";
      return new SocketFailure(
        endpoint,
        code,
        `Socket operation failed (${code}): ${endpoint}: ${causeDetail(cause)}`,
        { cause },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export interface SocketAddress {
  readonly host: string;
  readonly port: number;
}

/** One end of an established connection. */
export interface SocketConnection {
  readonly remote: SocketAddress;
  readonly local: SocketAddress;
  /** Whether the connection has been closed, by either end. */
  readonly closed: boolean;
  /** Send bytes. Resolves once the host has taken them. */
  write(bytes: Uint8Array): Promise<Result<void, SocketError>>;
  /**
   * Receive whatever bytes have arrived. Absent means a clean end-of-file: the
   * peer closed and nothing is left buffered. Not reentrant.
   */
  read(): Promise<Result<Optional<Uint8Array>, SocketError>>;
  /** Close this end. Idempotent; resolves once the host has released it. */
  close(): Promise<void>;
}

/** An accepting socket. */
export interface SocketListener {
  /** The bound address, with the port the host actually assigned. */
  address(): SocketAddress;
  readonly closed: boolean;
  /** Stop accepting and destroy every accepted connection. Idempotent. */
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** How long to wait for the connection to be established. Default 10s. */
  readonly timeoutMillis?: number;
  /** Cap on unread received bytes. Default 1 MiB. */
  readonly maxBufferedBytes?: number;
}

export interface ListenOptions {
  /** Interface to bind. Default `127.0.0.1`: loopback, never the whole network. */
  readonly host?: string;
  /** Cap on unread received bytes, per accepted connection. Default 1 MiB. */
  readonly maxBufferedBytes?: number;
  readonly backlog?: number;
}

/** What `listen` hands each accepted connection to. */
export type ConnectionHandler = (connection: SocketConnection) => void;

/**
 * TCP access. Nothing throws across this boundary: every failure the host can
 * report — at connect time, at bind time, or on the event path afterwards —
 * arrives as a `SocketError` in a `Result`.
 */
export abstract class Socket extends Context {
  abstract connect(host: string, port: number, options?: ConnectOptions): Promise<Result<SocketConnection, SocketError>>;
  abstract listen(
    port: number,
    onConnection: ConnectionHandler,
    options?: ListenOptions,
  ): Promise<Result<SocketListener, SocketError>>;
}

export const DEFAULT_MAX_BUFFERED_BYTES = 1_048_576;
const DEFAULT_CONNECT_TIMEOUT_MILLIS = 10_000;
const DEFAULT_LISTEN_HOST = "127.0.0.1";
const EPHEMERAL_PORT_BASE = 49_152;

function assertHost(host: string, caller: string): string {
  if (typeof host !== "string" || host.length === 0) panic(`${caller} requires a host name`);
  return host;
}

function assertPort(port: number, caller: string): number {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    panic(`${caller} requires a whole port between 0 and 65535`);
  }
  return port;
}

function assertBufferBytes(bytes: number | undefined, caller: string): number {
  if (bytes === undefined) return DEFAULT_MAX_BUFFERED_BYTES;
  if (!Number.isInteger(bytes) || bytes <= 0) panic(`${caller} maxBufferedBytes must be a positive whole number`);
  return bytes;
}

function assertTimeout(millis: number | undefined, caller: string): number {
  if (millis === undefined) return DEFAULT_CONNECT_TIMEOUT_MILLIS;
  if (!Number.isInteger(millis) || millis <= 0) panic(`${caller} timeoutMillis must be a positive whole number`);
  return millis;
}

function assertBytes(bytes: Uint8Array, caller: string): Uint8Array {
  if (!(bytes instanceof Uint8Array)) panic(`${caller} requires a Uint8Array`);
  return bytes;
}

function assertHandler(handler: ConnectionHandler, caller: string): ConnectionHandler {
  if (typeof handler !== "function") panic(`${caller} requires a connection handler function`);
  return handler;
}

function endpointOf(host: string, port: number): string {
  return `${host}:${port}`;
}

type ReadResult = Result<Optional<Uint8Array>, SocketError>;

/**
 * The byte-bounded receive buffer both implementations share, so the live and
 * in-memory sockets cannot drift apart on end-of-file, overflow, or the order in
 * which buffered data and a failure are delivered.
 */
class Inbox {
  readonly #chunks: Uint8Array[] = [];
  readonly #endpoint: string;
  readonly #max: number;
  #buffered = 0;
  #ended = false;
  #closed = false;
  #error: SocketError | undefined;
  #waiter: ((result: ReadResult) => void) | undefined;

  constructor(endpoint: string, max: number) {
    this.#endpoint = endpoint;
    this.#max = max;
  }

  get bufferedBytes(): number {
    return this.#buffered;
  }

  /** Append received bytes. `false` means the cap was passed and the inbox failed. */
  push(bytes: Uint8Array): boolean {
    if (this.#error !== undefined || this.#ended || this.#closed) return true;
    if (this.#buffered + bytes.length > this.#max) {
      this.fail(new ReceiveBufferOverflow(
        this.#endpoint,
        `Receive buffer overflowed (${this.#buffered + bytes.length} > ${this.#max} bytes): ${this.#endpoint}`,
      ));
      return false;
    }
    // Copied: a host chunk is a view on pooled memory that the host may reuse.
    this.#chunks.push(new Uint8Array(bytes));
    this.#buffered += bytes.length;
    this.#settle();
    return true;
  }

  /** The peer closed cleanly: everything buffered is still readable, then EOF. */
  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#settle();
  }

  /** The connection went away without a clean end. */
  closeAbruptly(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#settle();
  }

  fail(error: SocketError): void {
    if (this.#error === undefined) this.#error = error;
    this.#settle();
  }

  /** The current decision, or `undefined` when a reader must wait. */
  #poll(): ReadResult | undefined {
    if (this.#chunks.length > 0) {
      // Buffered bytes are delivered before any failure or end-of-file: data
      // that already arrived is data the peer sent.
      const joined = new Uint8Array(this.#buffered);
      let offset = 0;
      for (const chunk of this.#chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      this.#chunks.length = 0;
      this.#buffered = 0;
      return success(present(joined));
    }
    if (this.#error !== undefined) return failure(this.#error);
    if (this.#ended) return success(absent());
    if (this.#closed) return failure(new ConnectionClosed(this.#endpoint));
    return undefined;
  }

  #settle(): void {
    const waiter = this.#waiter;
    if (waiter === undefined) return;
    const ready = this.#poll();
    if (ready === undefined) return;
    this.#waiter = undefined;
    waiter(ready);
  }

  read(caller: string): Promise<ReadResult> {
    if (this.#waiter !== undefined) {
      panic(`${caller} is not reentrant: await the pending read before starting another`);
    }
    const ready = this.#poll();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise<ReadResult>((resolve) => {
      this.#waiter = resolve;
    });
  }
}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

function addressOf(candidate: unknown, fallback: SocketAddress): SocketAddress {
  if (candidate !== null && typeof candidate === "object") {
    const record = candidate as { readonly address?: unknown; readonly port?: unknown };
    if (typeof record.address === "string" && typeof record.port === "number") {
      return Object.freeze({ host: record.address, port: record.port });
    }
  }
  return fallback;
}

class NodeSocketConnection implements SocketConnection {
  readonly #socket: net.Socket;
  readonly #endpoint: string;
  readonly #inbox: Inbox;
  readonly #pendingWrites = new Set<(result: Result<void, SocketError>) => void>();
  #closing: Promise<void> | undefined;
  #closed = false;
  #error: SocketError | undefined;
  readonly remote: SocketAddress;
  readonly local: SocketAddress;

  constructor(socket: net.Socket, endpoint: string, maxBufferedBytes: number) {
    this.#socket = socket;
    this.#endpoint = endpoint;
    this.#inbox = new Inbox(endpoint, maxBufferedBytes);
    this.remote = Object.freeze({
      host: socket.remoteAddress ?? endpoint.slice(0, endpoint.lastIndexOf(":")),
      port: socket.remotePort ?? 0,
    });
    this.local = Object.freeze({ host: socket.localAddress ?? "", port: socket.localPort ?? 0 });

    // Every listener is attached here, before the first turn of the event loop
    // after construction, so no 'error' can ever reach the host as unhandled.
    socket.on("data", (chunk: Buffer) => {
      if (!this.#inbox.push(chunk)) socket.destroy();
    });
    socket.on("end", () => {
      this.#inbox.end();
    });
    socket.on("error", (cause: Error) => {
      this.#fail(toSocketError(endpoint, cause));
    });
    socket.on("close", () => {
      this.#closed = true;
      this.#inbox.closeAbruptly();
      this.#settleWrites();
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  #fail(error: SocketError): void {
    if (this.#error === undefined) this.#error = error;
    this.#inbox.fail(error);
    this.#settleWrites();
  }

  /** No write may outlive the connection: a dead socket settles them all. */
  #settleWrites(): void {
    if (this.#pendingWrites.size === 0) return;
    const error = this.#error ?? new ConnectionClosed(this.#endpoint);
    const pending = [...this.#pendingWrites];
    this.#pendingWrites.clear();
    for (const resolve of pending) resolve(failure(error));
  }

  write(bytes: Uint8Array): Promise<Result<void, SocketError>> {
    const payload = assertBytes(bytes, "SocketConnection.write");
    if (this.#error !== undefined) return Promise.resolve(failure(this.#error));
    if (this.#closed || this.#socket.destroyed || this.#socket.writableEnded) {
      return Promise.resolve(failure(new ConnectionClosed(this.#endpoint)));
    }
    return new Promise<Result<void, SocketError>>((resolve) => {
      let settled = false;
      const settle = (result: Result<void, SocketError>): void => {
        if (settled) return;
        settled = true;
        this.#pendingWrites.delete(settle);
        resolve(result);
      };
      this.#pendingWrites.add(settle);
      try {
        this.#socket.write(payload, (cause?: Error | null) => {
          settle(cause ? failure(toSocketError(this.#endpoint, cause)) : success(undefined));
        });
      } catch (cause) {
        // A synchronous throw (writing to an already destroyed socket on some
        // hosts) funnels into the same channel as an asynchronous one.
        settle(failure(toSocketError(this.#endpoint, cause)));
      }
    });
  }

  read(): Promise<Result<Optional<Uint8Array>, SocketError>> {
    return this.#inbox.read("SocketConnection.read");
  }

  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    if (this.#closed) return Promise.resolve();
    this.#closing = new Promise<void>((resolve) => {
      this.#socket.once("close", () => resolve());
      try {
        this.#socket.destroy();
      } catch {
        // Already gone; the 'close' listener above still settles the Promise if
        // the host emits, and this fallback covers a host that does not.
        resolve();
      }
    });
    return this.#closing;
  }
}

class NodeSocketListener implements SocketListener {
  readonly #server: net.Server;
  readonly #address: SocketAddress;
  readonly #accepted: Set<net.Socket>;
  #closing: Promise<void> | undefined;
  #closed = false;

  constructor(server: net.Server, address: SocketAddress, accepted: Set<net.Socket>) {
    this.#server = server;
    this.#address = address;
    this.#accepted = accepted;
    server.on("close", () => {
      this.#closed = true;
    });
  }

  address(): SocketAddress {
    return this.#address;
  }

  get closed(): boolean {
    return this.#closed;
  }

  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closing = new Promise<void>((resolve) => {
      // A listener owns what it accepted: destroying first means `close`
      // resolves promptly instead of waiting on a peer that never hangs up.
      for (const socket of this.#accepted) socket.destroy();
      this.#accepted.clear();
      this.#server.close(() => resolve());
    });
    return this.#closing;
  }
}

/** Node/Bun live implementation over `node:net`. */
export class NodeSocket extends Socket {
  static make(): NodeSocket {
    return new NodeSocket();
  }

  connect(host: string, port: number, options: ConnectOptions = {}): Promise<Result<SocketConnection, SocketError>> {
    const target = assertHost(host, "NodeSocket.connect");
    const targetPort = assertPort(port, "NodeSocket.connect");
    const maxBufferedBytes = assertBufferBytes(options.maxBufferedBytes, "NodeSocket.connect");
    const timeoutMillis = assertTimeout(options.timeoutMillis, "NodeSocket.connect");
    const endpoint = endpointOf(target, targetPort);

    return new Promise<Result<SocketConnection, SocketError>>((resolve) => {
      let settled = false;
      const socket = new net.Socket();
      const settle = (result: Result<SocketConnection, SocketError>): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      // Attached before `connect` is called, so a synchronous DNS or refusal
      // error has a listener waiting for it.
      socket.on("error", (cause: Error) => {
        if (settled) return;
        socket.destroy();
        settle(failure(toSocketError(endpoint, cause)));
      });
      socket.setTimeout(timeoutMillis, () => {
        if (settled) return;
        socket.destroy();
        settle(failure(new SocketTimeout(
          endpoint,
          `Connection timed out after ${timeoutMillis}ms: ${endpoint}`,
        )));
      });
      try {
        socket.connect({ host: target, port: targetPort }, () => {
          // The idle timeout is not a connection timeout; drop it once
          // established so a quiet connection is not torn down.
          socket.setTimeout(0);
          settle(success(new NodeSocketConnection(socket, endpoint, maxBufferedBytes)));
        });
      } catch (cause) {
        socket.destroy();
        settle(failure(toSocketError(endpoint, cause)));
      }
    });
  }

  listen(
    port: number,
    onConnection: ConnectionHandler,
    options: ListenOptions = {},
  ): Promise<Result<SocketListener, SocketError>> {
    const boundPort = assertPort(port, "NodeSocket.listen");
    const handler = assertHandler(onConnection, "NodeSocket.listen");
    const host = assertHost(options.host ?? DEFAULT_LISTEN_HOST, "NodeSocket.listen");
    const maxBufferedBytes = assertBufferBytes(options.maxBufferedBytes, "NodeSocket.listen");
    const endpoint = endpointOf(host, boundPort);

    return new Promise<Result<SocketListener, SocketError>>((resolve) => {
      let settled = false;
      const accepted = new Set<net.Socket>();
      const server = net.createServer();
      const settle = (result: Result<SocketListener, SocketError>): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      server.on("connection", (socket: net.Socket) => {
        accepted.add(socket);
        socket.once("close", () => accepted.delete(socket));
        const connection = new NodeSocketConnection(
          socket,
          endpointOf(socket.remoteAddress ?? host, socket.remotePort ?? 0),
          maxBufferedBytes,
        );
        try {
          handler(connection);
        } catch {
          // A throwing handler must not become an uncaught exception on the
          // accept path — there is no caller left to receive it — so the
          // connection it never took is destroyed and the peer sees the reset.
          socket.destroy();
        }
      });
      // Stays attached after listening: a later server error (a host dropping
      // the bound socket) must never be an unhandled 'error' event.
      server.on("error", (cause: Error) => {
        settle(failure(toSocketError(endpoint, cause)));
      });
      try {
        server.listen({ host, port: boundPort, ...(options.backlog === undefined ? {} : { backlog: options.backlog }) }, () => {
          settle(success(new NodeSocketListener(
            server,
            addressOf(server.address(), { host, port: boundPort }),
            accepted,
          )));
        });
      } catch (cause) {
        settle(failure(toSocketError(endpoint, cause)));
      }
    });
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

class MemoryConnection implements SocketConnection {
  readonly #inbox: Inbox;
  readonly #endpoint: string;
  #peer: MemoryConnection | undefined;
  #closed = false;
  readonly remote: SocketAddress;
  readonly local: SocketAddress;

  constructor(endpoint: string, local: SocketAddress, remote: SocketAddress, maxBufferedBytes: number) {
    this.#endpoint = endpoint;
    this.#inbox = new Inbox(endpoint, maxBufferedBytes);
    this.local = local;
    this.remote = remote;
  }

  static pair(
    client: SocketAddress,
    server: SocketAddress,
    maxBufferedBytes: number,
  ): readonly [MemoryConnection, MemoryConnection] {
    const endpoint = endpointOf(server.host, server.port);
    const clientSide = new MemoryConnection(endpoint, client, server, maxBufferedBytes);
    const serverSide = new MemoryConnection(endpoint, server, client, maxBufferedBytes);
    clientSide.#peer = serverSide;
    serverSide.#peer = clientSide;
    return [clientSide, serverSide];
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Same-class private access: the peer hands bytes straight into this inbox. */
  #deliver(bytes: Uint8Array): boolean {
    return this.#inbox.push(bytes);
  }

  #peerEnded(): void {
    this.#inbox.end();
  }

  write(bytes: Uint8Array): Promise<Result<void, SocketError>> {
    const payload = assertBytes(bytes, "SocketConnection.write");
    const peer = this.#peer;
    if (this.#closed || peer === undefined || peer.#closed) {
      return Promise.resolve(failure(new ConnectionClosed(this.#endpoint)));
    }
    if (!peer.#deliver(payload)) {
      // The peer's receive buffer overflowed; both ends see the connection die.
      const overflow = new ReceiveBufferOverflow(this.#endpoint);
      this.#inbox.fail(overflow);
      return Promise.resolve(failure(overflow));
    }
    return Promise.resolve(success(undefined));
  }

  read(): Promise<Result<Optional<Uint8Array>, SocketError>> {
    return this.#inbox.read("SocketConnection.read");
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    // A clean close: the peer drains what it has, then sees end-of-file.
    const peer = this.#peer;
    if (peer !== undefined) peer.#peerEnded();
    this.#inbox.closeAbruptly();
    return Promise.resolve();
  }
}

class MemoryListener implements SocketListener {
  readonly #address: SocketAddress;
  readonly #onClose: () => void;
  #closed = false;

  constructor(address: SocketAddress, onClose: () => void) {
    this.#address = address;
    this.#onClose = onClose;
  }

  address(): SocketAddress {
    return this.#address;
  }

  get closed(): boolean {
    return this.#closed;
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#onClose();
    return Promise.resolve();
  }
}

export interface MemorySocketOptions {
  /** Cap on unread bytes for every connection this double creates. */
  readonly maxBufferedBytes?: number;
}

interface MemoryBinding {
  readonly onConnection: ConnectionHandler;
  readonly address: SocketAddress;
  readonly maxBufferedBytes: number;
}

/**
 * Deterministic implementation: an in-process socket pair and a registry of
 * listeners keyed by address. Nothing here touches the network, so a test can
 * exercise a full connect / write / read / end-of-file round trip — and a
 * refused connection — with no port, no DNS, and no timing.
 */
export class MemorySocket extends Socket {
  readonly #bindings = new Map<string, MemoryBinding>();
  readonly #maxBufferedBytes: number;
  #nextPort = EPHEMERAL_PORT_BASE;
  #clientPort = 32_768;

  private constructor(maxBufferedBytes: number) {
    super();
    this.#maxBufferedBytes = maxBufferedBytes;
  }

  static make(options: MemorySocketOptions = {}): MemorySocket {
    return new MemorySocket(assertBufferBytes(options.maxBufferedBytes, "MemorySocket.make"));
  }

  /** `localhost` and `127.0.0.1` name the same interface in the double. */
  static #normalize(host: string): string {
    return host === "localhost" || host === "::1" ? DEFAULT_LISTEN_HOST : host;
  }

  /** Every address currently bound, sorted; convenient in assertions. */
  bound(): readonly string[] {
    return [...this.#bindings.keys()].sort();
  }

  /**
   * Not `async`: an unusable argument must panic at the call site, exactly as it
   * does in the live implementation, rather than becoming a rejected Promise.
   */
  connect(
    host: string,
    port: number,
    options: ConnectOptions = {},
  ): Promise<Result<SocketConnection, SocketError>> {
    const target = MemorySocket.#normalize(assertHost(host, "MemorySocket.connect"));
    const targetPort = assertPort(port, "MemorySocket.connect");
    assertTimeout(options.timeoutMillis, "MemorySocket.connect");
    const maxBufferedBytes = options.maxBufferedBytes === undefined
      ? this.#maxBufferedBytes
      : assertBufferBytes(options.maxBufferedBytes, "MemorySocket.connect");
    const endpoint = endpointOf(target, targetPort);
    const binding = this.#bindings.get(endpoint);
    if (binding === undefined) return Promise.resolve(failure(new ConnectionRefused(endpoint)));

    this.#clientPort += 1;
    const [clientSide, serverSide] = MemoryConnection.pair(
      Object.freeze({ host: target, port: this.#clientPort }),
      binding.address,
      Math.min(maxBufferedBytes, binding.maxBufferedBytes),
    );
    // The handler runs before `connect` resolves, exactly as an accept happens
    // before the client can send: a handler that reads immediately never misses
    // a byte.
    try {
      binding.onConnection(serverSide);
    } catch {
      // Mirrors the live accept path: a throwing handler loses its connection
      // rather than turning into an uncaught exception.
      void serverSide.close();
    }
    return Promise.resolve(success(clientSide));
  }

  /** Not `async`, for the same reason `connect` is not. */
  listen(
    port: number,
    onConnection: ConnectionHandler,
    options: ListenOptions = {},
  ): Promise<Result<SocketListener, SocketError>> {
    const requested = assertPort(port, "MemorySocket.listen");
    const handler = assertHandler(onConnection, "MemorySocket.listen");
    const host = MemorySocket.#normalize(assertHost(options.host ?? DEFAULT_LISTEN_HOST, "MemorySocket.listen"));
    const maxBufferedBytes = options.maxBufferedBytes === undefined
      ? this.#maxBufferedBytes
      : assertBufferBytes(options.maxBufferedBytes, "MemorySocket.listen");

    let assigned = requested;
    if (assigned === 0) {
      // Port 0 means "give me one", the same contract the host honours.
      while (this.#bindings.has(endpointOf(host, this.#nextPort))) this.#nextPort += 1;
      assigned = this.#nextPort;
      this.#nextPort += 1;
    }
    const endpoint = endpointOf(host, assigned);
    if (this.#bindings.has(endpoint)) return Promise.resolve(failure(new AddressInUse(endpoint)));

    const address: SocketAddress = Object.freeze({ host, port: assigned });
    this.#bindings.set(endpoint, { onConnection: handler, address, maxBufferedBytes });
    return Promise.resolve(success(new MemoryListener(address, () => {
      this.#bindings.delete(endpoint);
    })));
  }
}

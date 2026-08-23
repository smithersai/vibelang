import {
  decodeError,
  encodeError,
  isLocalError,
  registerErrorCodec,
  type JsonValue,
  type NominalError,
} from "../runtime/errors.ts";
import {
  __vsInspectResult,
  __vsResultFailure,
  __vsResultSuccess,
  isResult,
  type Result,
} from "../runtime/result.ts";
import { isOptional } from "../runtime/optional.ts";
import {
  ValueCodecError,
  decodeOptional,
  decodeResult,
  encodeOptional,
  encodeResult,
  type ValueCodec,
} from "../runtime/wire.ts";

const PROTOCOL_VERSION = 1;
const RUNTIME_WIRE_LIMIT = 1_048_576;
const MAX_VALUE_DEPTH = 64;
const DEFAULT_MAX_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const RESERVED_FUNCTION_NAMES = new Set(["__proto__", "constructor", "prototype", "terminate", "then"]);

/** The library API is intentionally provisional while `spawn module {}` remains design direction. */
export const TYPED_WORKER_API_STATUS = "provisional" as const;

export interface WorkerCrashContext {
  readonly moduleUrl: string;
  readonly event: "close" | "error" | "startup";
  readonly exitCode: number | null;
  readonly detail: string;
}

export class WorkerTerminated extends Error {
  constructor(message = "typed worker was terminated") {
    super(message);
    this.name = "WorkerTerminated";
  }
}
export interface WorkerTerminated extends NominalError<"smithers:WorkerTerminated@1"> {}

export class WorkerCrashed extends Error {
  readonly context: WorkerCrashContext;

  constructor(context: WorkerCrashContext) {
    super(`typed worker crashed during ${context.event}: ${context.detail}`);
    this.name = "WorkerCrashed";
    this.context = Object.freeze({ ...context });
  }
}
export interface WorkerCrashed extends NominalError<"smithers:WorkerCrashed@1"> {}

export class WorkerCallTimeout extends Error {
  constructor(
    readonly callId: string,
    readonly timeoutMs: number,
  ) {
    super(`typed worker call ${callId} exceeded ${timeoutMs}ms`);
    this.name = "WorkerCallTimeout";
  }
}
export interface WorkerCallTimeout extends NominalError<"smithers:WorkerCallTimeout@1"> {}

export class WorkerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerProtocolError";
  }
}
export interface WorkerProtocolError extends NominalError<"smithers:WorkerProtocolError@1"> {}

function recordPayload(payload: JsonValue, expected: readonly string[], label: string): Record<string, JsonValue> {
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw new TypeError(`${label} payload must be an object`);
  }
  exactKeys(payload, expected, `${label} payload`);
  return payload;
}

registerErrorCodec(WorkerTerminated, "smithers:WorkerTerminated@1", {
  encode: (error) => ({ message: error.message }),
  decode: (payload) => {
    const value = recordPayload(payload, ["message"], "WorkerTerminated");
    if (typeof value.message !== "string") throw new TypeError("WorkerTerminated message must be a string");
    return new WorkerTerminated(value.message);
  },
});

registerErrorCodec(WorkerCrashed, "smithers:WorkerCrashed@1", {
  encode: (error) => ({
    detail: error.context.detail,
    event: error.context.event,
    exitCode: error.context.exitCode,
    moduleUrl: error.context.moduleUrl,
  }),
  decode: (payload) => {
    const value = recordPayload(payload, ["detail", "event", "exitCode", "moduleUrl"], "WorkerCrashed");
    if (
      typeof value.detail !== "string" ||
      (value.event !== "close" && value.event !== "error" && value.event !== "startup") ||
      (value.exitCode !== null && (!Number.isInteger(value.exitCode) || typeof value.exitCode !== "number")) ||
      typeof value.moduleUrl !== "string"
    ) throw new TypeError("invalid WorkerCrashed context");
    return new WorkerCrashed({
      detail: value.detail,
      event: value.event,
      exitCode: value.exitCode,
      moduleUrl: value.moduleUrl,
    });
  },
});

registerErrorCodec(WorkerCallTimeout, "smithers:WorkerCallTimeout@1", {
  encode: (error) => ({ callId: error.callId, timeoutMs: error.timeoutMs }),
  decode: (payload) => {
    const value = recordPayload(payload, ["callId", "timeoutMs"], "WorkerCallTimeout");
    if (typeof value.callId !== "string" || typeof value.timeoutMs !== "number" || !Number.isInteger(value.timeoutMs)) {
      throw new TypeError("invalid WorkerCallTimeout payload");
    }
    return new WorkerCallTimeout(value.callId, value.timeoutMs);
  },
});

registerErrorCodec(WorkerProtocolError, "smithers:WorkerProtocolError@1", {
  encode: (error) => ({ message: error.message }),
  decode: (payload) => {
    const value = recordPayload(payload, ["message"], "WorkerProtocolError");
    if (typeof value.message !== "string") throw new TypeError("WorkerProtocolError message must be a string");
    return new WorkerProtocolError(value.message);
  },
});

// wire.ts intentionally has no dependency back on errors.ts. The worker layer
// supplies the transport registration needed when codec failures cross realms.
registerErrorCodec(ValueCodecError, "smithers:ValueCodecError@1", {
  encode: (error) => ({ message: error.message }),
  decode: (payload) => {
    const value = recordPayload(payload, ["message"], "ValueCodecError");
    if (typeof value.message !== "string") throw new TypeError("ValueCodecError message must be a string");
    return new ValueCodecError(value.message);
  },
});

export interface TypedWorkerCallOptions {
  /** Wall-clock timeout, including time spent in the backpressure queue. */
  readonly timeoutMs?: number;
}

export interface TypedWorkerSpawnOptions<FunctionName extends string = string> {
  readonly functions: readonly FunctionName[];
  readonly maxConcurrency?: number;
  readonly maxMessageBytes?: number;
  readonly timeoutMs?: number;
  readonly startupTimeoutMs?: number;
}

type WorkerFunction = (input: never) => unknown;
type CallableKey<Contract extends object> = {
  [Key in keyof Contract]-?: Contract[Key] extends (...arguments_: never[]) => unknown ? Key : never;
}[keyof Contract] & string;
type RemoteResult<Output> = Awaited<Output> extends Result<infer Value, infer Failure>
  ? Result<Value, Failure>
  : Result<Awaited<Output>, never>;
type RemoteMethod<Method> = Method extends (input: infer Input) => infer Output
  ? (input: Input, options?: TypedWorkerCallOptions) => Promise<RemoteResult<Output>>
  : never;

export interface TypedWorkerLifecycle {
  /** Rejects outstanding calls before resolving after the backing worker closes. */
  terminate(): Promise<void>;
}

/** Provisional proxy type used by the library lowering for a typed worker module. */
export type TypedWorkerHandle<Contract extends object> = {
  readonly [Key in keyof Contract as Contract[Key] extends (...arguments_: never[]) => unknown ? Key : never]:
    RemoteMethod<Contract[Key]>;
} & TypedWorkerLifecycle;

interface ValidatedOptions {
  readonly functions: readonly string[];
  readonly maxConcurrency: number;
  readonly maxMessageBytes: number;
  readonly timeoutMs: number;
  readonly startupTimeoutMs: number;
}

interface WorkerBootstrap {
  readonly kind: "smithers-worker-bootstrap";
  readonly version: 1;
  readonly moduleUrl: string;
  readonly functions: readonly string[];
  readonly maxMessageBytes: number;
  readonly port: MessagePort;
}

type ControllerState = "starting" | "ready" | "terminating" | "terminated" | "failed";
type JobState = "queued" | "active";

interface Job {
  readonly id: string;
  readonly request: string;
  readonly timeoutMs: number;
  readonly resolve: (result: Result<unknown, Error>) => void;
  readonly reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  state: JobState;
  consumerSettled: boolean;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Worker lifecycle failures must never create an unhandled internal rejection.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function rejected<T>(error: Error): Promise<T> {
  const promise = Promise.reject<T>(error);
  void promise.catch(() => undefined);
  return promise;
}

function positiveInteger(value: unknown, fallback: number, label: string, maximum = 2_147_483_647): number {
  const selected = value === undefined ? fallback : value;
  if (typeof selected !== "number" || !Number.isInteger(selected) || selected < 1 || selected > maximum) {
    throw new RangeError(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return selected;
}

function validateOptions(options: TypedWorkerSpawnOptions): ValidatedOptions {
  if (options === null || typeof options !== "object" || !Array.isArray(options.functions)) {
    throw new TypeError("TypedWorker.spawn requires a functions array");
  }
  if (options.functions.length === 0 || options.functions.length > 256) {
    throw new RangeError("TypedWorker.spawn functions must contain between 1 and 256 names");
  }
  const seen = new Set<string>();
  const functions = options.functions.map((name) => {
    if (typeof name !== "string" || name.length === 0 || name.length > 256 || RESERVED_FUNCTION_NAMES.has(name)) {
      throw new TypeError(`invalid typed worker function name ${JSON.stringify(name)}`);
    }
    if (seen.has(name)) throw new TypeError(`duplicate typed worker function ${name}`);
    seen.add(name);
    return name;
  });
  const maxMessageBytes = positiveInteger(
    options.maxMessageBytes,
    RUNTIME_WIRE_LIMIT,
    "maxMessageBytes",
    RUNTIME_WIRE_LIMIT,
  );
  if (maxMessageBytes < 256) throw new RangeError("maxMessageBytes must be at least 256");
  return Object.freeze({
    functions: Object.freeze(functions),
    maxConcurrency: positiveInteger(options.maxConcurrency, DEFAULT_MAX_CONCURRENCY, "maxConcurrency", 1_024),
    maxMessageBytes,
    timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs"),
    startupTimeoutMs: positiveInteger(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, "startupTimeoutMs"),
  });
}

function moduleHref(moduleUrl: string | URL): string {
  if (moduleUrl instanceof URL) return moduleUrl.href;
  if (typeof moduleUrl !== "string" || moduleUrl.length === 0) {
    throw new TypeError("TypedWorker.spawn moduleUrl must be a URL or non-empty string");
  }
  try {
    return new URL(moduleUrl).href;
  } catch {
    const base = new URL(`file://${process.cwd().replaceAll("%", "%25").replaceAll("#", "%23").replaceAll("?", "%3F")}/`);
    return new URL(moduleUrl, base).href;
  }
}

function ownDataValue(value: object, key: PropertyKey, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new ValueCodecError(`${path} must be an enumerable data property`);
  }
  return descriptor.value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new WorkerProtocolError(`${label} has unexpected fields`);
  }
}

interface CodecContext {
  readonly seen: Set<object>;
  nestedDepth: number;
}

let activeEncodeContext: CodecContext | undefined;
let activeDecodeDepth: number | undefined;

function boundaryNode(value: unknown, context: CodecContext, depth: number): JsonValue {
  if (depth > MAX_VALUE_DEPTH) throw new ValueCodecError("worker value exceeds the codec depth limit");
  if (value === null) return { type: "null" };
  if (value === undefined) return { type: "undefined" };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ValueCodecError("worker value contains a non-finite number");
    return { type: "number", value };
  }
  if (typeof value !== "object") throw new ValueCodecError("worker value is not codec data");
  if (context.seen.has(value)) throw new ValueCodecError("worker value contains a cycle");
  context.seen.add(value);
  try {
    if (isResult(value)) {
      const priorDepth = context.nestedDepth;
      context.nestedDepth = depth + 1;
      try {
        return { type: "result", wire: encodeResult(value, workerValueCodec) };
      } finally {
        context.nestedDepth = priorDepth;
      }
    }
    if (isOptional(value)) {
      const priorDepth = context.nestedDepth;
      context.nestedDepth = depth + 1;
      try {
        return { type: "optional", wire: encodeOptional(value, workerValueCodec) };
      } finally {
        context.nestedDepth = priorDepth;
      }
    }
    if (isLocalError(value)) return { type: "error", wire: encodeError(value) };
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new ValueCodecError("worker value is not an ordinary array");
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new ValueCodecError(`worker value has a sparse hole at ${index}`);
        output.push(boundaryNode(ownDataValue(value, String(index), `$[${index}]`), context, depth + 1));
      }
      const extras = Reflect.ownKeys(value).filter(
        (key) => key !== "length" && !(typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)),
      );
      if (extras.length > 0) throw new ValueCodecError("worker array has non-index properties");
      return { type: "array", value: output };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ValueCodecError("worker value has a non-codec prototype");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) throw new ValueCodecError("worker object has a symbol key");
    const entries: JsonValue[] = [];
    for (const key of (keys as string[]).sort()) {
      entries.push([key, boundaryNode(ownDataValue(value, key, `$.${key}`), context, depth + 1)]);
    }
    return { type: "object", value: entries };
  } finally {
    context.seen.delete(value);
  }
}

function encodeBoundaryValue(value: unknown): JsonValue {
  const root = activeEncodeContext === undefined;
  const context = activeEncodeContext ?? { seen: new Set<object>(), nestedDepth: 0 };
  if (root) activeEncodeContext = context;
  try {
    return boundaryNode(value, context, context.nestedDepth);
  } finally {
    if (root) activeEncodeContext = undefined;
  }
}

function nodeRecord(node: JsonValue, depth: number): Record<string, JsonValue> {
  if (depth > MAX_VALUE_DEPTH) throw new ValueCodecError("worker value exceeds the codec depth limit");
  if (node === null || Array.isArray(node) || typeof node !== "object") {
    throw new ValueCodecError("worker codec node must be an object");
  }
  return node;
}

function nodeType(record: Record<string, JsonValue>): string {
  if (typeof record.type !== "string") throw new ValueCodecError("worker codec node type must be a string");
  return record.type;
}

function codecExactKeys(record: Record<string, JsonValue>, expected: readonly string[]): void {
  try {
    exactKeys(record, expected, "worker codec node");
  } catch (cause) {
    throw new ValueCodecError("worker codec node has unexpected fields", { cause });
  }
}

function decodeBoundaryNode(node: JsonValue, depth: number): unknown {
  const record = nodeRecord(node, depth);
  switch (nodeType(record)) {
    case "null":
      codecExactKeys(record, ["type"]);
      return null;
    case "undefined":
      codecExactKeys(record, ["type"]);
      return undefined;
    case "boolean":
      codecExactKeys(record, ["type", "value"]);
      if (typeof record.value !== "boolean") throw new ValueCodecError("worker boolean node is invalid");
      return record.value;
    case "number":
      codecExactKeys(record, ["type", "value"]);
      if (typeof record.value !== "number" || !Number.isFinite(record.value)) {
        throw new ValueCodecError("worker number node is invalid");
      }
      return record.value;
    case "string":
      codecExactKeys(record, ["type", "value"]);
      if (typeof record.value !== "string") throw new ValueCodecError("worker string node is invalid");
      return record.value;
    case "array": {
      codecExactKeys(record, ["type", "value"]);
      if (!Array.isArray(record.value)) throw new ValueCodecError("worker array node is invalid");
      return record.value.map((entry) => decodeBoundaryNode(entry, depth + 1));
    }
    case "object": {
      codecExactKeys(record, ["type", "value"]);
      if (!Array.isArray(record.value)) throw new ValueCodecError("worker object node is invalid");
      const output = Object.create(null) as Record<string, unknown>;
      let priorKey: string | undefined;
      for (const entry of record.value) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
          throw new ValueCodecError("worker object entry is invalid");
        }
        const key = entry[0];
        if (priorKey !== undefined && key <= priorKey) {
          throw new ValueCodecError("worker object keys must be unique and sorted");
        }
        priorKey = key;
        Object.defineProperty(output, key, {
          value: decodeBoundaryNode(entry[1], depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    }
    case "error":
      codecExactKeys(record, ["type", "wire"]);
      if (typeof record.wire !== "string") throw new ValueCodecError("worker Error wire must be a string");
      return decodeError(record.wire);
    case "result": {
      codecExactKeys(record, ["type", "wire"]);
      if (typeof record.wire !== "string") throw new ValueCodecError("worker Result wire must be a string");
      const priorDepth = activeDecodeDepth;
      activeDecodeDepth = depth + 1;
      try {
        return decodeResult(record.wire, workerValueCodec);
      } finally {
        activeDecodeDepth = priorDepth;
      }
    }
    case "optional": {
      codecExactKeys(record, ["type", "wire"]);
      if (typeof record.wire !== "string") throw new ValueCodecError("worker Optional wire must be a string");
      const priorDepth = activeDecodeDepth;
      activeDecodeDepth = depth + 1;
      try {
        return decodeOptional(record.wire, workerValueCodec);
      } finally {
        activeDecodeDepth = priorDepth;
      }
    }
    default:
      throw new ValueCodecError("worker codec node has an unsupported type");
  }
}

function decodeBoundaryValue(node: JsonValue): unknown {
  const root = activeDecodeDepth === undefined;
  if (root) activeDecodeDepth = 0;
  try {
    return decodeBoundaryNode(node, activeDecodeDepth ?? 0);
  } finally {
    if (root) activeDecodeDepth = undefined;
  }
}

const workerValueCodec: ValueCodec<unknown> = Object.freeze({
  encode: encodeBoundaryValue,
  decode: decodeBoundaryValue,
});

function assertJsonValue(value: unknown, depth = 0): asserts value is JsonValue {
  if (depth > MAX_VALUE_DEPTH) throw new WorkerProtocolError("message exceeds the JSON depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WorkerProtocolError("message contains a non-finite number");
    return;
  }
  if (typeof value !== "object") throw new WorkerProtocolError("message contains non-JSON data");
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new WorkerProtocolError("message contains a sparse array");
      assertJsonValue(value[index], depth + 1);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== null) throw new WorkerProtocolError("message records must have null prototypes");
  for (const key of Object.keys(value)) assertJsonValue((value as Record<string, unknown>)[key], depth + 1);
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function nullPrototypeReviver(_key: string, value: unknown): unknown {
  if (value === null || Array.isArray(value) || typeof value !== "object") return value;
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    Object.defineProperty(output, key, {
      value: (value as Record<string, unknown>)[key],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function parseMessage(message: unknown, maximumBytes: number): Record<string, JsonValue> {
  if (typeof message !== "string") throw new WorkerProtocolError("worker message must be a string");
  if (byteLength(message) > maximumBytes) throw new WorkerProtocolError("worker message exceeds the configured size limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(message, nullPrototypeReviver);
  } catch (cause) {
    throw new WorkerProtocolError(`worker message is not valid JSON: ${cause instanceof Error ? cause.message : "parse failed"}`);
  }
  assertJsonValue(parsed);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new WorkerProtocolError("worker message envelope must be an object");
  }
  if (canonicalJson(parsed) !== message) throw new WorkerProtocolError("worker message is not canonical JSON");
  return parsed;
}

function messageWire(fields: Record<string, JsonValue>, maximumBytes: number): string {
  const wire = canonicalJson(fields);
  if (byteLength(wire) > maximumBytes) throw new WorkerProtocolError("worker message exceeds the configured size limit");
  return wire;
}

function messageRecord(fields: Record<string, JsonValue>): Record<string, JsonValue> {
  return Object.assign(Object.create(null) as Record<string, JsonValue>, fields);
}

function eventDetail(event: ErrorEvent): string {
  const location = event.filename
    ? ` (${event.filename}${event.lineno ? `:${event.lineno}:${event.colno}` : ""})`
    : "";
  return `${event.message || "uncaught worker error"}${location}`;
}

class WorkerController {
  readonly #raw: Worker;
  readonly #port: MessagePort;
  readonly #moduleUrl: string;
  readonly #options: ValidatedOptions;
  readonly #ready = deferred<void>();
  readonly #closed = deferred<void>();
  readonly #queue: Job[] = [];
  readonly #active = new Map<string, Job>();
  #state: ControllerState = "starting";
  #terminalError: Error | undefined;
  #termination: Promise<void> | undefined;
  #startupTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(raw: Worker, port: MessagePort, moduleUrl: string, options: ValidatedOptions) {
    this.#raw = raw;
    this.#port = port;
    this.#moduleUrl = moduleUrl;
    this.#options = options;

    port.addEventListener("message", (event) => this.#onPortMessage(event.data));
    port.addEventListener("messageerror", () => {
      this.#fail(new WorkerProtocolError("typed worker message could not be deserialized"), true);
    });
    port.start();

    raw.addEventListener("error", (event) => {
      event.preventDefault();
      this.#fail(new WorkerCrashed({
        moduleUrl,
        event: "error",
        exitCode: null,
        detail: eventDetail(event),
      }), false);
    });
    raw.addEventListener("close", (rawEvent) => {
      const event = rawEvent as CloseEvent;
      this.#closed.resolve();
      if (this.#state === "terminating" || this.#state === "terminated") {
        this.#state = "terminated";
        return;
      }
      if (this.#state !== "failed") {
        this.#fail(new WorkerCrashed({
          moduleUrl,
          event: "close",
          exitCode: Number.isInteger(event.code) ? event.code : null,
          detail: event.reason || (event.wasClean ? "worker closed unexpectedly" : "worker exited abnormally"),
        }), false);
      }
    });

    this.#startupTimer = setTimeout(() => {
      this.#fail(new WorkerCrashed({
        moduleUrl,
        event: "startup",
        exitCode: null,
        detail: `worker did not become ready within ${options.startupTimeoutMs}ms`,
      }), true);
    }, options.startupTimeoutMs);
  }

  get ready(): Promise<void> { return this.#ready.promise; }

  call(method: string, input: unknown, callOptions?: TypedWorkerCallOptions): Promise<Result<unknown, Error>> {
    if (this.#state !== "ready") {
      return rejected(this.#terminalError ?? new WorkerTerminated());
    }
    let timeoutMs: number;
    let request: string;
    const id = crypto.randomUUID();
    try {
      if (callOptions !== undefined && (callOptions === null || typeof callOptions !== "object")) {
        throw new TypeError("typed worker call options must be an object");
      }
      timeoutMs = positiveInteger(callOptions?.timeoutMs, this.#options.timeoutMs, "call timeoutMs");
      const payload = encodeResult(__vsResultSuccess(input), workerValueCodec);
      request = messageWire(messageRecord({
        id,
        kind: "call",
        method,
        payload,
        version: PROTOCOL_VERSION,
      }), this.#options.maxMessageBytes);
    } catch (cause) {
      return rejected(cause instanceof Error ? cause : new WorkerProtocolError("typed worker input encoding failed"));
    }

    const completion = deferred<Result<unknown, Error>>();
    const job: Job = {
      id,
      request,
      timeoutMs,
      resolve: completion.resolve,
      reject: (error) => completion.reject(error),
      timer: undefined,
      state: "queued",
      consumerSettled: false,
    };
    job.timer = setTimeout(() => this.#timeOut(job), timeoutMs);
    this.#queue.push(job);
    this.#drain();
    return completion.promise;
  }

  terminate(): Promise<void> {
    if (this.#termination) return this.#termination;
    const termination = (async () => {
      if (this.#state === "terminated") return;
      const error = new WorkerTerminated();
      if (this.#state !== "failed") {
        this.#state = "terminating";
        this.#terminalError = error;
        this.#settleAll(error);
      }
      this.#clearStartupTimer();
      this.#port.close();
      this.#raw.terminate();
      await this.#closed.promise;
      this.#state = "terminated";
    })();
    void termination.catch(() => undefined);
    this.#termination = termination;
    return termination;
  }

  #clearStartupTimer(): void {
    if (this.#startupTimer !== undefined) clearTimeout(this.#startupTimer);
    this.#startupTimer = undefined;
  }

  #onPortMessage(raw: unknown): void {
    if (this.#state === "failed" || this.#state === "terminating" || this.#state === "terminated") return;
    try {
      const message = parseMessage(raw, this.#options.maxMessageBytes);
      if (message.version !== PROTOCOL_VERSION || typeof message.kind !== "string") {
        throw new WorkerProtocolError("worker message has an unsupported envelope");
      }
      if (this.#state === "starting") {
        this.#acceptStartupMessage(message);
        return;
      }
      this.#acceptCallMessage(message);
    } catch (cause) {
      this.#fail(
        cause instanceof WorkerProtocolError
          ? cause
          : new WorkerProtocolError(`worker response validation failed: ${cause instanceof Error ? cause.message : "unknown error"}`),
        true,
      );
    }
  }

  #acceptStartupMessage(message: Record<string, JsonValue>): void {
    if (message.kind === "fatal") {
      exactKeys(message, ["error", "kind", "version"], "worker startup failure");
      if (typeof message.error !== "string") throw new WorkerProtocolError("worker startup failure Error must be a string");
      let detail: string;
      try {
        detail = decodeError(message.error).message;
      } catch (cause) {
        detail = `undecodable startup failure: ${cause instanceof Error ? cause.message : "unknown error"}`;
      }
      this.#fail(new WorkerCrashed({
        moduleUrl: this.#moduleUrl,
        event: "startup",
        exitCode: null,
        detail,
      }), true);
      return;
    }
    exactKeys(message, ["functions", "kind", "version"], "worker ready message");
    if (message.kind !== "ready" || !Array.isArray(message.functions)) {
      throw new WorkerProtocolError("worker did not send a ready message");
    }
    if (
      message.functions.length !== this.#options.functions.length ||
      message.functions.some((name, index) => name !== this.#options.functions[index])
    ) throw new WorkerProtocolError("worker ready function list did not match its contract");
    this.#clearStartupTimer();
    this.#state = "ready";
    this.#ready.resolve();
  }

  #acceptCallMessage(message: Record<string, JsonValue>): void {
    if (message.kind !== "result" && message.kind !== "fault") {
      throw new WorkerProtocolError("worker sent an unsupported call response");
    }
    exactKeys(message, message.kind === "result"
      ? ["id", "kind", "payload", "version"]
      : ["error", "id", "kind", "version"], "worker call response");
    if (typeof message.id !== "string") throw new WorkerProtocolError("worker response id must be a string");
    const job = this.#active.get(message.id);
    if (!job) throw new WorkerProtocolError("worker response used an unknown or replayed call id");
    this.#active.delete(job.id);
    if (job.timer !== undefined) clearTimeout(job.timer);
    job.timer = undefined;
    try {
      if (!job.consumerSettled) {
        job.consumerSettled = true;
        if (message.kind === "result") {
          if (typeof message.payload !== "string") throw new WorkerProtocolError("worker Result payload must be a string");
          job.resolve(decodeResult(message.payload, workerValueCodec));
        } else {
          if (typeof message.error !== "string") throw new WorkerProtocolError("worker fault Error must be a string");
          job.reject(decodeError(message.error));
        }
      }
    } finally {
      this.#drain();
    }
  }

  #drain(): void {
    if (this.#state !== "ready") return;
    while (this.#active.size < this.#options.maxConcurrency && this.#queue.length > 0) {
      const job = this.#queue.shift()!;
      if (job.consumerSettled) continue;
      job.state = "active";
      this.#active.set(job.id, job);
      try {
        this.#port.postMessage(job.request);
      } catch (cause) {
        this.#fail(new WorkerProtocolError(
          `failed to post typed worker call: ${cause instanceof Error ? cause.message : "unknown error"}`,
        ), true);
        return;
      }
    }
  }

  #timeOut(job: Job): void {
    job.timer = undefined;
    if (job.consumerSettled) return;
    job.consumerSettled = true;
    job.reject(new WorkerCallTimeout(job.id, job.timeoutMs));
    if (job.state === "queued") {
      const index = this.#queue.indexOf(job);
      if (index >= 0) this.#queue.splice(index, 1);
    }
    // Active work is not assumed cancellable. It continues to occupy a slot
    // until its eventual response, preserving the real concurrency bound.
  }

  #settleAll(error: Error): void {
    for (const job of [...this.#queue, ...this.#active.values()]) {
      if (job.timer !== undefined) clearTimeout(job.timer);
      job.timer = undefined;
      if (!job.consumerSettled) {
        job.consumerSettled = true;
        job.reject(error);
      }
    }
    this.#queue.length = 0;
    this.#active.clear();
  }

  #fail(error: Error, terminateWorker: boolean): void {
    if (this.#state === "failed" || this.#state === "terminated" || this.#state === "terminating") return;
    this.#state = "failed";
    this.#terminalError = error;
    this.#clearStartupTimer();
    this.#settleAll(error);
    this.#ready.reject(error);
    this.#port.close();
    if (terminateWorker) this.#raw.terminate();
  }
}

function createHandle<Contract extends object>(controller: WorkerController, functions: readonly string[]): TypedWorkerHandle<Contract> {
  const handle = Object.create(null) as Record<string, unknown>;
  for (const name of functions) {
    Object.defineProperty(handle, name, {
      value: (input: unknown, options?: TypedWorkerCallOptions) => controller.call(name, input, options),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  Object.defineProperty(handle, "terminate", {
    value: () => controller.terminate(),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(handle) as TypedWorkerHandle<Contract>;
}

/**
 * Provisional library layer for the future worker-module syntax lowering.
 * Both realms must import the declarations that register nominal Error codecs.
 */
export class TypedWorker {
  private constructor() {}

  static async spawn<Contract extends object = Record<string, WorkerFunction>>(
    moduleUrl: string | URL,
    options: TypedWorkerSpawnOptions<CallableKey<Contract>>,
  ): Promise<TypedWorkerHandle<Contract>> {
    if (!Bun.isMainThread) throw new TypeError("TypedWorker.spawn may only be called from the main thread");
    const validated = validateOptions(options as TypedWorkerSpawnOptions);
    const href = moduleHref(moduleUrl);
    const channel = new MessageChannel();
    const raw = new Worker(new URL(import.meta.url), {
      name: "smithers-typed-worker",
      ref: true,
      type: "module",
    });
    const controller = new WorkerController(raw, channel.port2, href, validated);
    const bootstrap: WorkerBootstrap = {
      kind: "smithers-worker-bootstrap",
      version: PROTOCOL_VERSION,
      moduleUrl: href,
      functions: validated.functions,
      maxMessageBytes: validated.maxMessageBytes,
      port: channel.port1,
    };
    try {
      raw.postMessage(bootstrap, [channel.port1]);
      await controller.ready;
      return createHandle<Contract>(controller, validated.functions);
    } catch (cause) {
      await controller.terminate();
      throw cause;
    }
  }
}

function bootstrapRecord(value: unknown): value is WorkerBootstrap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "functions,kind,maxMessageBytes,moduleUrl,port,version") return false;
  return (
    record.kind === "smithers-worker-bootstrap" &&
    record.version === PROTOCOL_VERSION &&
    typeof record.moduleUrl === "string" &&
    Array.isArray(record.functions) &&
    record.functions.every((name) => typeof name === "string") &&
    typeof record.maxMessageBytes === "number" &&
    Number.isInteger(record.maxMessageBytes) &&
    record.port instanceof MessagePort
  );
}

function workerFault(cause: unknown): string {
  if (isLocalError(cause)) {
    try {
      return encodeError(cause);
    } catch (encodingCause) {
      return encodeError(new WorkerProtocolError(
        `worker boundary Error was not transportable: ${encodingCause instanceof Error ? encodingCause.message : "unknown error"}`,
      ));
    }
  }
  return encodeError(new WorkerProtocolError("worker function threw a non-Error value"));
}

async function serveWorker(bootstrap: WorkerBootstrap): Promise<void> {
  const { functions, maxMessageBytes, moduleUrl, port } = bootstrap;
  const post = port.postMessage.bind(port);
  const send = (fields: Record<string, JsonValue>): void => post(messageWire(messageRecord(fields), maxMessageBytes));
  const closeAfterDelivery = (): void => { setTimeout(() => port.close(), 0); };
  port.start();
  try {
    const loaded = await import(moduleUrl) as Record<string, unknown>;
    const exports = new Map<string, (input: unknown) => unknown>();
    for (const name of functions) {
      const implementation = loaded[name];
      if (typeof implementation !== "function") throw new TypeError(`worker module does not export function ${name}`);
      exports.set(name, implementation as (input: unknown) => unknown);
    }

    const onMessage = (event: MessageEvent): void => {
      void (async () => {
        let id: string | undefined;
        try {
          const message = parseMessage(event.data, maxMessageBytes);
          exactKeys(message, ["id", "kind", "method", "payload", "version"], "worker call request");
          if (
            message.version !== PROTOCOL_VERSION || message.kind !== "call" ||
            typeof message.id !== "string" || typeof message.method !== "string" || typeof message.payload !== "string"
          ) throw new WorkerProtocolError("worker call request has an unsupported envelope");
          id = message.id;
          const implementation = exports.get(message.method);
          if (!implementation) throw new WorkerProtocolError("worker call selected a function outside its contract");
          const inputEnvelope = __vsInspectResult(decodeResult(message.payload, workerValueCodec));
          if (!inputEnvelope.ok) throw new WorkerProtocolError("worker call input must use a successful Result envelope");

          let result: Result<unknown, Error>;
          try {
            const output = await implementation(inputEnvelope.value);
            result = isResult(output)
              ? output as Result<unknown, Error>
              : __vsResultSuccess(output);
          } catch (cause) {
            if (!isLocalError(cause)) throw cause;
            result = __vsResultFailure(cause);
          }
          let payload: string;
          try {
            payload = encodeResult(result, workerValueCodec);
          } catch (cause) {
            send({ error: workerFault(cause), id, kind: "fault", version: PROTOCOL_VERSION });
            return;
          }
          send({ id, kind: "result", payload, version: PROTOCOL_VERSION });
        } catch (cause) {
          if (id !== undefined) {
            send({ error: workerFault(cause), id, kind: "fault", version: PROTOCOL_VERSION });
            return;
          }
          throw cause;
        }
      })().catch((cause) => {
        try {
          send({ error: workerFault(cause), kind: "fatal", version: PROTOCOL_VERSION });
        } catch {
          // If even the fatal envelope exceeds the configured bound, closing
          // the private channel is the only fail-closed outcome left.
        } finally {
          closeAfterDelivery();
        }
      });
    };
    port.addEventListener("message", onMessage);
    port.addEventListener("messageerror", () => {
      try {
        send({ error: encodeError(new WorkerProtocolError("worker request could not be deserialized")), kind: "fatal", version: PROTOCOL_VERSION });
      } catch {
        // The close below still prevents continued use of a corrupt channel.
      } finally {
        closeAfterDelivery();
      }
    }, { once: true });
    send({ functions: [...functions], kind: "ready", version: PROTOCOL_VERSION });
  } catch (cause) {
    try {
      send({ error: workerFault(cause), kind: "fatal", version: PROTOCOL_VERSION });
    } catch {
      // A bounded transport cannot report an oversized fatal envelope on the
      // same channel; closure makes startup fail closed on the host.
    } finally {
      closeAfterDelivery();
    }
  }
}

function acceptBootstrap(event: MessageEvent): void {
  if (!bootstrapRecord(event.data)) throw new WorkerProtocolError("typed worker received an invalid bootstrap message");
  const bootstrap = event.data;
  const retained: WorkerBootstrap = {
    functions: [...bootstrap.functions],
    kind: "smithers-worker-bootstrap",
    maxMessageBytes: bootstrap.maxMessageBytes,
    moduleUrl: bootstrap.moduleUrl,
    port: bootstrap.port,
    version: PROTOCOL_VERSION,
  };
  // Remove the transferred port from the structured-clone record before any
  // user module is imported. Only this module's closure retains the channel.
  for (const key of Reflect.ownKeys(bootstrap)) Reflect.deleteProperty(bootstrap, key);
  void serveWorker(retained).catch(() => retained.port.close());
}

if (!Bun.isMainThread) {
  globalThis.addEventListener("message", acceptBootstrap, { once: true });
}

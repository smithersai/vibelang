import { type JsonValue, registerErrorCodec, registerErrorType } from "../runtime/errors.ts";
import { Context } from "../runtime/layer.ts";
import { Optional } from "../runtime/optional.ts";
import { Result, rethrowPanics } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { causeDetail } from "./internal.ts";

const { failure, success } = RuntimeValues;

export type HttpMethod = "GET" | "POST";

/** Base of the HTTP failure channel; every case names the URL that produced it. */
export abstract class HttpError extends Error {
  constructor(
    readonly url: string,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "HttpError";
  }
}

registerErrorType(HttpError, "smithers:HttpError@1");

export class InvalidUrl extends HttpError {
  constructor(url: string, message = `Not an absolute http(s) URL: ${url}`, options?: { readonly cause?: unknown }) {
    super(url, message, options);
    this.name = "InvalidUrl";
  }
}

/** The request never produced a response: DNS, connection, or transport failure. */
export class RequestFailed extends HttpError {
  constructor(url: string, message = `Request failed: ${url}`, options?: { readonly cause?: unknown }) {
    super(url, message, options);
    this.name = "RequestFailed";
  }
}

export class RequestTimeout extends HttpError {
  constructor(
    url: string,
    readonly timeoutMillis: number,
    message = `Request timed out after ${timeoutMillis}ms: ${url}`,
    options?: { readonly cause?: unknown },
  ) {
    super(url, message, options);
    this.name = "RequestTimeout";
  }
}

/** Raised only by `HttpResponse.ensureOk()`; a non-2xx status is otherwise a success. */
export class UnexpectedStatus extends HttpError {
  constructor(
    url: string,
    readonly status: number,
    message = `Unexpected HTTP status ${status}: ${url}`,
    options?: { readonly cause?: unknown },
  ) {
    super(url, message, options);
    this.name = "UnexpectedStatus";
  }
}

export class MalformedResponse extends HttpError {
  constructor(url: string, message = `Response body was malformed: ${url}`, options?: { readonly cause?: unknown }) {
    super(url, message, options);
    this.name = "MalformedResponse";
  }
}

function urlPayload(error: HttpError): JsonValue {
  return { url: error.url, message: error.message };
}

function decodeUrlPayload(payload: JsonValue): { readonly url: string; readonly message: string } {
  if (
    payload === null || Array.isArray(payload) || typeof payload !== "object" ||
    Object.keys(payload).length !== 2 ||
    typeof payload.url !== "string" || typeof payload.message !== "string"
  ) {
    throw new TypeError("invalid HttpError payload");
  }
  return { url: payload.url, message: payload.message };
}

type UrlErrorConstructor = new (url: string, message?: string) => HttpError;

const urlErrors: ReadonlyArray<readonly [UrlErrorConstructor, string]> = [
  [InvalidUrl, "smithers:InvalidUrl@1"],
  [RequestFailed, "smithers:RequestFailed@1"],
  [MalformedResponse, "smithers:MalformedResponse@1"],
];

for (const [type, id] of urlErrors) {
  registerErrorCodec(type, id, {
    encode: urlPayload,
    decode: (payload) => {
      const { url, message } = decodeUrlPayload(payload);
      return new type(url, message);
    },
  });
}

registerErrorCodec(RequestTimeout, "smithers:RequestTimeout@1", {
  encode: (error): JsonValue => ({ url: error.url, timeoutMillis: error.timeoutMillis, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 3 ||
      typeof payload.url !== "string" || typeof payload.timeoutMillis !== "number" ||
      typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid RequestTimeout payload");
    }
    return new RequestTimeout(payload.url, payload.timeoutMillis, payload.message);
  },
});

registerErrorCodec(UnexpectedStatus, "smithers:UnexpectedStatus@1", {
  encode: (error): JsonValue => ({ url: error.url, status: error.status, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 3 ||
      typeof payload.url !== "string" || typeof payload.status !== "number" ||
      typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid UnexpectedStatus payload");
    }
    return new UnexpectedStatus(payload.url, payload.status, payload.message);
  },
});

export interface HttpResponseInit {
  readonly url: string;
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * A fully materialized response. The body is buffered by the client before the
 * response is handed back, so nothing here is async and no stream outlives the
 * `Layer.provide` scope that produced it.
 */
export class HttpResponse {
  readonly #body: string;

  private constructor(
    readonly url: string,
    readonly status: number,
    readonly headers: ReadonlyMap<string, string>,
    body: string,
  ) {
    this.#body = body;
  }

  static of(init: HttpResponseInit): HttpResponse {
    const headers = new Map<string, string>();
    for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name.toLowerCase(), value);
    return new HttpResponse(init.url, init.status, headers, init.body ?? "");
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  /** Header lookup by case-insensitive name. */
  header(name: string): Optional<string> {
    return Optional.fromNullable(this.headers.get(name.toLowerCase()));
  }

  text(): string {
    return this.#body;
  }

  json(): Result<unknown, MalformedResponse> {
    return rethrowPanics(Result.try(
      (): unknown => JSON.parse(this.#body),
      (cause) => new MalformedResponse(this.url, `Response body was not JSON: ${causeDetail(cause)}`, { cause }),
    ));
  }

  /** Promote a non-2xx status into the failure channel when the caller wants that. */
  ensureOk(): Result<HttpResponse, UnexpectedStatus> {
    return this.ok ? success(this) : failure(new UnexpectedStatus(this.url, this.status));
  }
}

export interface HttpRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMillis?: number;
}

export interface HttpPostOptions extends HttpRequestOptions {
  readonly body?: string;
}

/**
 * Network access. A response is a success at any status; only a transport
 * failure, a timeout, or an unusable URL enters the `HttpError` channel.
 */
export abstract class HttpClient extends Context {
  abstract get(url: string, options?: HttpRequestOptions): Promise<Result<HttpResponse, HttpError>>;
  abstract post(url: string, options?: HttpPostOptions): Promise<Result<HttpResponse, HttpError>>;
}

const DEFAULT_TIMEOUT_MILLIS = 30_000;

interface FetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal: AbortSignal;
}

interface FetchHeaders {
  forEach(callback: (value: string, name: string) => void): void;
}

interface FetchResponse {
  readonly status: number;
  readonly headers: FetchHeaders;
  text(): Promise<string>;
}

/** The single foreign function this client depends on; injectable for tests. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface FetchHttpClientOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMillis?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** `undefined` when the URL is usable; otherwise the nominal rejection. */
function invalidUrl(url: string): InvalidUrl | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    return new InvalidUrl(url, undefined, { cause });
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? undefined : new InvalidUrl(url);
}

/** Live implementation over the host `fetch`. */
export class FetchHttpClient extends HttpClient {
  readonly #fetch: FetchLike;
  readonly #timeoutMillis: number;
  readonly #headers: Readonly<Record<string, string>>;

  private constructor(fetchLike: FetchLike, timeoutMillis: number, headers: Readonly<Record<string, string>>) {
    super();
    this.#fetch = fetchLike;
    this.#timeoutMillis = timeoutMillis;
    this.#headers = headers;
  }

  static make(options: FetchHttpClientOptions = {}): FetchHttpClient {
    const injected = options.fetch;
    return new FetchHttpClient(
      injected ?? ((url, init) => globalThis.fetch(url, init) as unknown as Promise<FetchResponse>),
      options.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS,
      Object.freeze({ ...options.headers }),
    );
  }

  get(url: string, options: HttpRequestOptions = {}): Promise<Result<HttpResponse, HttpError>> {
    return this.#send("GET", url, options, undefined);
  }

  post(url: string, options: HttpPostOptions = {}): Promise<Result<HttpResponse, HttpError>> {
    return this.#send("POST", url, options, options.body ?? "");
  }

  async #send(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions,
    body: string | undefined,
  ): Promise<Result<HttpResponse, HttpError>> {
    const rejected = invalidUrl(url);
    if (rejected !== undefined) return failure(rejected);

    const timeoutMillis = options.timeoutMillis ?? this.#timeoutMillis;
    let timedOut = false;
    const attempted = await Result.tryPromise(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMillis);
        try {
          const response = await this.#fetch(url, {
            method,
            headers: { ...this.#headers, ...options.headers },
            ...(body === undefined ? {} : { body }),
            signal: controller.signal,
          });
          // The body is drained here so the response handed to callers owns no
          // stream that could outlive the surrounding scope.
          const text = await response.text();
          const headers: Record<string, string> = {};
          response.headers.forEach((value, name) => {
            headers[name.toLowerCase()] = value;
          });
          return HttpResponse.of({ url, status: response.status, headers, body: text });
        } finally {
          clearTimeout(timer);
        }
      },
      (cause): HttpError =>
        timedOut
          ? new RequestTimeout(url, timeoutMillis, undefined, { cause })
          : new RequestFailed(url, `Request failed: ${url}: ${causeDetail(cause)}`, { cause }),
    );
    return rethrowPanics(attempted);
  }
}

export interface StubRoute {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface StubRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

type StubOutcome =
  | { readonly kind: "response"; readonly route: StubRoute }
  | { readonly kind: "failure"; readonly error: HttpError };

/**
 * Programmed implementation for tests. Every route is declared up front and an
 * unrouted request fails rather than reaching the network.
 */
export class StubHttpClient extends HttpClient {
  readonly #routes = new Map<string, StubOutcome>();
  readonly #requests: StubRequest[] = [];

  private constructor() {
    super();
  }

  static make(): StubHttpClient {
    return new StubHttpClient();
  }

  route(method: HttpMethod, url: string, response: StubRoute = {}): this {
    this.#routes.set(`${method} ${url}`, { kind: "response", route: response });
    return this;
  }

  /** Program a transport failure for a route. */
  fail(method: HttpMethod, url: string, error: HttpError): this {
    this.#routes.set(`${method} ${url}`, { kind: "failure", error });
    return this;
  }

  get requests(): readonly StubRequest[] {
    return this.#requests.slice();
  }

  clear(): this {
    this.#requests.length = 0;
    return this;
  }

  async get(url: string, options: HttpRequestOptions = {}): Promise<Result<HttpResponse, HttpError>> {
    return this.#send("GET", url, options, undefined);
  }

  async post(url: string, options: HttpPostOptions = {}): Promise<Result<HttpResponse, HttpError>> {
    return this.#send("POST", url, options, options.body ?? "");
  }

  #send(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions,
    body: string | undefined,
  ): Result<HttpResponse, HttpError> {
    const rejected = invalidUrl(url);
    if (rejected !== undefined) return failure(rejected);
    this.#requests.push(Object.freeze({
      method,
      url,
      headers: Object.freeze({ ...options.headers }),
      ...(body === undefined ? {} : { body }),
    }));
    const outcome = this.#routes.get(`${method} ${url}`);
    if (outcome === undefined) {
      return failure(new RequestFailed(url, `StubHttpClient has no route for ${method} ${url}`));
    }
    if (outcome.kind === "failure") return failure(outcome.error);
    return success(HttpResponse.of({
      url,
      status: outcome.route.status ?? 200,
      ...(outcome.route.headers === undefined ? {} : { headers: outcome.route.headers }),
      ...(outcome.route.body === undefined ? {} : { body: outcome.route.body }),
    }));
  }
}

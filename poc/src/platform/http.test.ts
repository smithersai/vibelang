import { describe, expect, test } from "bun:test";
import { type ErrorConstructor, decodeError, encodeError, errorIs } from "../runtime/errors.ts";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import {
  type FetchLike,
  FetchHttpClient,
  HttpClient,
  HttpError,
  HttpResponse,
  InvalidUrl,
  MalformedResponse,
  RequestFailed,
  RequestTimeout,
  StubHttpClient,
  UnexpectedStatus,
} from "./http.ts";

type ErrorType = ErrorConstructor<HttpError>;

const ENDPOINT = "https://api.example.test/users/1";

function failureOf<A>(result: Result<A, HttpError>): HttpError {
  return result.match({
    ok: (value) => {
      throw new Error(`expected a failure, received ${String(value)}`);
    },
    error: (error) => error,
  });
}

function expectFailure<A>(result: Result<A, HttpError>, type: ErrorType, url: string): HttpError {
  const error = failureOf(result);
  expect(errorIs(error, type)).toBe(true);
  expect(error.url).toBe(url);
  return error;
}

function value<A>(result: Result<A, HttpError>): A {
  return result.match({
    ok: (ok) => ok,
    error: (error) => {
      throw error;
    },
  });
}

/** A fetch double so the live client is exercised without touching the network. */
function fakeFetch(
  handler: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    status: number;
    headers?: Record<string, string>;
    body?: string;
  },
): FetchLike {
  return async (url, init) => {
    const programmed = handler(url, { method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }) });
    return {
      status: programmed.status,
      headers: {
        forEach(callback: (headerValue: string, name: string) => void): void {
          for (const [name, headerValue] of Object.entries(programmed.headers ?? {})) callback(headerValue, name);
        },
      },
      text: async () => programmed.body ?? "",
    };
  };
}

/** The contract every HttpClient implementation must satisfy. */
async function assertHttpContract(client: HttpClient): Promise<void> {
  const response = value(await client.get(ENDPOINT));
  expect(response.status).toBe(200);
  expect(response.ok).toBe(true);
  expect(response.text()).toBe(`{"id":1,"name":"ada"}`);
  expect(response.header("Content-Type").unwrapOr("<none>")).toBe("application/json");
  expect(response.header("content-type").unwrapOr("<none>")).toBe("application/json");
  expect(response.header("x-missing").isNone()).toBe(true);
  expect(value(response.json())).toEqual({ id: 1, name: "ada" });
  expect(value(response.ensureOk())).toBe(response);

  const created = value(await client.post(ENDPOINT, { body: `{"name":"grace"}` }));
  expect(created.status).toBe(201);

  // A non-2xx status is an ordinary success; the caller opts into failing on it.
  const notFound = value(await client.get("https://api.example.test/users/404"));
  expect(notFound.ok).toBe(false);
  expect(notFound.status).toBe(404);
  const statusError = failureOf(notFound.ensureOk());
  expect(errorIs(statusError, UnexpectedStatus)).toBe(true);
  expect((statusError as UnexpectedStatus).status).toBe(404);

  const malformed = value(await client.get("https://api.example.test/broken"));
  expect(failureOf(malformed.json())).toBeInstanceOf(MalformedResponse);

  // An unusable URL never reaches the transport.
  expectFailure(await client.get("not-a-url"), InvalidUrl, "not-a-url");
  expectFailure(await client.get("file:///etc/passwd"), InvalidUrl, "file:///etc/passwd");
}

function programmedFetch(): FetchLike {
  return fakeFetch((url, init) => {
    if (url === "https://api.example.test/users/404") return { status: 404, body: "missing" };
    if (url === "https://api.example.test/broken") return { status: 200, body: "{not json" };
    if (init.method === "POST") return { status: 201, body: init.body ?? "" };
    return { status: 200, headers: { "Content-Type": "application/json" }, body: `{"id":1,"name":"ada"}` };
  });
}

function programmedStub(): StubHttpClient {
  return StubHttpClient.make()
    .route("GET", ENDPOINT, { status: 200, headers: { "Content-Type": "application/json" }, body: `{"id":1,"name":"ada"}` })
    .route("POST", ENDPOINT, { status: 201, body: `{"name":"grace"}` })
    .route("GET", "https://api.example.test/users/404", { status: 404, body: "missing" })
    .route("GET", "https://api.example.test/broken", { status: 200, body: "{not json" });
}

describe("HttpClient", () => {
  test("FetchHttpClient satisfies the contract over an injected fetch", async () => {
    await assertHttpContract(FetchHttpClient.make({ fetch: programmedFetch() }));
  });

  test("StubHttpClient satisfies the contract from programmed routes", async () => {
    await assertHttpContract(programmedStub());
  });

  test("FetchHttpClient sends method, headers, and body, and lowercases response headers", async () => {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    const client = FetchHttpClient.make({
      headers: { "User-Agent": "vibelang" },
      fetch: fakeFetch((url, init) => {
        seen.push({ url, ...init });
        return { status: 200, headers: { "X-Trace-Id": "abc" }, body: "ok" };
      }),
    });

    const response = value(await client.post(ENDPOINT, { headers: { Authorization: "token" }, body: "payload" }));
    expect(response.header("x-trace-id").unwrapOr("")).toBe("abc");
    expect(seen).toEqual([{
      url: ENDPOINT,
      method: "POST",
      headers: { "User-Agent": "vibelang", Authorization: "token" },
      body: "payload",
    }]);
  });

  test("a transport rejection becomes RequestFailed and a hang becomes RequestTimeout", async () => {
    const failing = FetchHttpClient.make({
      fetch: async () => {
        throw new TypeError("connect ECONNREFUSED");
      },
    });
    const transport = expectFailure(await failing.get(ENDPOINT), RequestFailed, ENDPOINT);
    expect(transport.message).toContain("ECONNREFUSED");

    const hanging = FetchHttpClient.make({
      timeoutMillis: 5,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    });
    const timeout = expectFailure(await hanging.get(ENDPOINT), RequestTimeout, ENDPOINT);
    expect((timeout as RequestTimeout).timeoutMillis).toBe(5);
  });

  test("StubHttpClient records requests and refuses unrouted ones", async () => {
    const client = programmedStub();
    await client.get(ENDPOINT, { headers: { Accept: "application/json" } });
    await client.post(ENDPOINT, { body: "payload" });
    expect(client.requests).toEqual([
      { method: "GET", url: ENDPOINT, headers: { Accept: "application/json" } },
      { method: "POST", url: ENDPOINT, headers: {}, body: "payload" },
    ]);

    // No route means no network: an unprogrammed call fails in the typed channel.
    const unrouted = expectFailure(
      await client.get("https://api.example.test/unrouted"),
      RequestFailed,
      "https://api.example.test/unrouted",
    );
    expect(unrouted.message).toContain("no route");

    // A method mismatch is also unrouted.
    expect(failureOf(await client.post("https://api.example.test/users/404"))).toBeInstanceOf(RequestFailed);

    client.clear();
    expect(client.requests).toEqual([]);
  });

  test("StubHttpClient can program a transport failure for a route", async () => {
    const client = StubHttpClient.make().fail("GET", ENDPOINT, new RequestTimeout(ENDPOINT, 250));
    const error = expectFailure(await client.get(ENDPOINT), RequestTimeout, ENDPOINT);
    expect((error as RequestTimeout).timeoutMillis).toBe(250);
  });

  test("HttpResponse.of normalizes headers and defaults an empty body", () => {
    const response = HttpResponse.of({ url: ENDPOINT, status: 204 });
    expect(response.text()).toBe("");
    expect(response.headers.size).toBe(0);
    expect(response.ok).toBe(true);
    expect(failureOf(response.json())).toBeInstanceOf(MalformedResponse);
    expect(HttpResponse.of({ url: ENDPOINT, status: 500 }).ok).toBe(false);
  });

  test("http errors survive the wire codec", () => {
    for (const error of [
      new InvalidUrl("nope"),
      new RequestFailed(ENDPOINT),
      new MalformedResponse(ENDPOINT),
      new RequestTimeout(ENDPOINT, 1_000),
      new UnexpectedStatus(ENDPOINT, 503),
    ]) {
      const decoded = decodeError(encodeError(error));
      expect(decoded.constructor).toBe(error.constructor);
      expect((decoded as HttpError).url).toBe(error.url);
      expect(decoded.message).toBe(error.message);
    }
    const timeout = decodeError(encodeError(new RequestTimeout(ENDPOINT, 1_000)));
    expect((timeout as RequestTimeout).timeoutMillis).toBe(1_000);
    const status = decodeError(encodeError(new UnexpectedStatus(ENDPOINT, 503)));
    expect((status as UnexpectedStatus).status).toBe(503);
  });

  test("HttpClient resolves through a Layer under its nominal key", async () => {
    const client = programmedStub();
    // The capability is resolved synchronously inside the scope; the request it
    // returns is awaited outside, because the Bun host cannot observe Promise
    // settlement synchronously and so rejects an async Layer body.
    const resolved = Layer.provide(Layer.succeed(HttpClient, client), () => HttpClient.context());
    expect(resolved).toBe(client);
    expect(value(await resolved.get(ENDPOINT)).status).toBe(200);
    expect(isPanic(catchPanic(() => HttpClient.context(), (error) => error))).toBe(true);
  });
});

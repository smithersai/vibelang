import { expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Logger, Metric, References } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as TestClock from "effect/testing/TestClock"
import * as Otlp from "../src/experimental/Otlp.js"
import * as transport from "../src/experimental/internal/otlpTransport.js"

interface Sent {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string
}

// A collector that records every request and answers 200.
const collector = (answer: () => Effect.Effect<Response> = () => Effect.succeed(new Response(null, { status: 200 }))) => {
  const sent: Array<Sent> = []
  const client = HttpClient.make((request, url) =>
    Effect.suspend(() => {
      const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
      sent.push({ url: url.href, headers: { ...request.headers }, body })
      return Effect.map(answer(), (response) => HttpClientResponse.fromWeb(request, response))
    })
  )
  return { sent, layer: Layer.succeed(HttpClient.HttpClient)(client) }
}

const SECRET = "ghp_ABCDEFGHIJKLMNOPQRSTUVWX"

const program = Effect.gen(function*() {
  yield* Effect.logInfo(`triage started with token=${SECRET}`)
  yield* Effect.annotateCurrentSpan({
    "api_key": "plain-value-123",
    "gen_ai.prompt": "summarize the private notes",
    "gen_ai.usage.input_tokens": 42,
    "note": `Bearer ${SECRET}`
  })
  yield* Metric.update(Metric.counter("issues_labeled"), 1)
  return "done"
}).pipe(Effect.withSpan("triage"))

const exported = async (options: Partial<Otlp.Options> = {}) => {
  const host = collector()
  const layer = Otlp.layer({ url: "http://localhost:4318", service: "triage", ...options }).pipe(Layer.provide(host.layer))
  const result = await Effect.runPromise(Effect.provide(program, layer))
  return { result, sent: host.sent }
}

test("VIP-72: logs, metrics and traces reach the collector at /v1/*", async () => {
  const { result, sent } = await exported()
  expect(result).toBe("done")
  const paths = new Set(sent.map((request) => new URL(request.url).pathname))
  expect(paths).toEqual(new Set(["/v1/logs", "/v1/metrics", "/v1/traces"]))
  const traces = sent.filter((request) => request.url.endsWith("/v1/traces")).map((request) => request.body).join("")
  expect(traces).toContain('"triage"')
  expect(traces).toContain('"service.name"')
})

test("VIP-72 rule 2: records are scrubbed before export", async () => {
  const { sent } = await exported()
  const all = sent.map((request) => request.body).join("\n")
  expect(all).not.toContain(SECRET)
  expect(all).not.toContain("plain-value-123")
  expect(all).toContain("[REDACTED]")
  // A count of tokens is a count, not a credential.
  expect(all).toContain("gen_ai.usage.input_tokens")
  expect(all).toMatch(/"gen_ai\.usage\.input_tokens","value":\{"intValue":"?42/)
})

test("VIP-72 rule 8: content is off by default and on by a named option", async () => {
  const off = (await exported()).sent.map((request) => request.body).join("\n")
  expect(off).not.toContain("gen_ai.prompt")
  expect(off).not.toContain("summarize the private notes")
  const on = (await exported({ content: true })).sent.map((request) => request.body).join("\n")
  expect(on).toContain("summarize the private notes")
  expect(on).not.toContain(SECRET)
})

test("VIP-72 rule 1: an export that fails never fails the step", async () => {
  const host = collector(() => Effect.die(new Error("collector down")))
  const layer = Otlp.layer({ url: "http://localhost:4318", service: "triage", shutdownTimeout: "100 millis" }).pipe(
    Layer.provide(host.layer)
  )
  const exit = await Effect.runPromiseExit(Effect.provide(program, layer))
  expect(Exit.isSuccess(exit)).toBe(true)
})

test("VIP-72 rule 3: a resource is validated when the layer is built", async () => {
  const bad: ReadonlyArray<Partial<Otlp.Options>> = [
    { service: "" },
    { service: "s".repeat(1025) },
    { version: "v".repeat(1025) },
    { attributes: { ["k".repeat(1025)]: "x" } },
    { attributes: { nested: { a: 1 } } },
    { attributes: { mixed: [1, "a"] } },
    { attributes: { "service.name": "other" } },
    { attributes: { infinite: Number.POSITIVE_INFINITY } },
    { attributes: { big: "x".repeat(130 * 1024) } },
    { service: "line\nbreak" }
  ]
  for (const options of bad) {
    const exit = await Effect.runPromiseExit(Effect.provide(
      Effect.void,
      Otlp.layer({ url: "http://localhost:4318", service: "triage", ...options }).pipe(Layer.provide(collector().layer))
    ))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain("InvalidResourceConfiguration")
  }
  const ok = await Effect.runPromise(Otlp.resource({
    service: "s".repeat(1024),
    attributes: { ["k".repeat(1024)]: "x", list: ["a", "b"], n: 1, b: true }
  }))
  expect(ok.serviceName.length).toBe(1024)
})

test("VIP-72: a bad collector URL fails the layer, and credentials need https off this machine", async () => {
  const bad: ReadonlyArray<{ readonly url: string; readonly headers?: Record<string, string> }> = [
    { url: "localhost:4318" },
    { url: "ftp://collector.example.com" },
    { url: "https://user:pw@collector.example.com" },
    { url: "https://collector.example.com/?q=1" },
    { url: "https://collector.example.com/#x" },
    { url: "https://collector.example.com/a b" },
    { url: "http://collector.example.com", headers: { authorization: "Bearer x" } },
    { url: "http://collector.example.com", headers: { "x-honeycomb-team": "x" } }
  ]
  for (const item of bad) {
    const exit = await Effect.runPromiseExit(Otlp.endpoint(item.url, item.headers))
    expect([item.url, Exit.isFailure(exit)]).toEqual([item.url, true])
  }
  expect(await Effect.runPromise(Otlp.endpoint("http://127.0.0.1:4318/", { authorization: "Bearer x" }))).toBe(
    "http://127.0.0.1:4318"
  )
  expect(await Effect.runPromise(Otlp.endpoint("https://collector.example.com/otlp", { authorization: "x" }))).toBe(
    "https://collector.example.com/otlp"
  )
  expect(await Effect.runPromise(Otlp.endpoint("http://collector.example.com", { "x-tenant": "a" }))).toBe(
    "http://collector.example.com"
  )
})

test("VIP-72 rule 5: ambient OTEL_RESOURCE_ATTRIBUTES cannot enlarge the resource", async () => {
  const previous = process.env["OTEL_RESOURCE_ATTRIBUTES"]
  process.env["OTEL_RESOURCE_ATTRIBUTES"] = "ambient.leak=yes"
  try {
    const { sent } = await exported()
    expect(sent.map((request) => request.body).join("\n")).not.toContain("ambient.leak")
  } finally {
    if (previous === undefined) delete process.env["OTEL_RESOURCE_ATTRIBUTES"]
    else process.env["OTEL_RESOURCE_ATTRIBUTES"] = previous
  }
})

// The transport alone, so a test can hold requests in flight.
interface Warning {
  readonly message: unknown
  readonly level: string
  readonly annotations: Record<string, unknown>
}

const capturing = () => {
  const warnings: Array<Warning> = []
  const logger = Logger.make((options) => {
    warnings.push({
      message: options.message,
      level: options.logLevel,
      annotations: { ...options.fiber.getRef(References.CurrentLogAnnotations) }
    })
  })
  return { warnings, layer: Logger.layer([logger]) }
}

const post = (bytes: number) =>
  Effect.flatMap(Effect.service(HttpClient.HttpClient), (client) =>
    client.execute(HttpClientRequest.post("http://localhost:4318/v1/logs").pipe(
      HttpClientRequest.bodyUint8Array(new TextEncoder().encode(JSON.stringify({ pad: "x".repeat(bytes) })), "application/json")
    )))

test("VIP-72 rule 4: a batch over the cap is discarded, counted, and warned about once a minute", async () => {
  const host = collector()
  const logs = capturing()
  const layer = transport.layer({ maxRequestBytes: 100, content: false }).pipe(
    Layer.provide(host.layer),
    Layer.provide(logs.layer)
  )
  const before = (await Effect.runPromise(Metric.value(Otlp.dropped))).count
  const statuses = await Effect.runPromise(Effect.provide(
    Effect.all([post(10), post(500), post(500)]).pipe(Effect.map((answers) => answers.map((answer) => answer.status))),
    layer
  ))
  expect(statuses).toEqual([200, 204, 204])
  expect(host.sent).toHaveLength(1)
  const after = (await Effect.runPromise(Metric.value(Otlp.dropped))).count
  expect(after - before).toBe(2)
  const warned = logs.warnings.filter((warning) => warning.annotations["code"] === "otlp_export_discarded")
  expect(warned).toHaveLength(1)
  expect(warned[0]!.level).toBe("Warn")
  expect(warned[0]!.annotations["reason"]).toBe("oversized")
  // The warning never enters the exporter.
  expect(host.sent.map((request) => request.body).join("")).not.toContain("otlp_export_discarded")
})

test("VIP-72 rule 4: beyond four requests in flight a batch is discarded as saturated", async () => {
  const gate = Effect.runSync(Deferred.make<void>())
  const host = collector(() => Effect.as(Deferred.await(gate), new Response(null, { status: 200 })))
  const logs = capturing()
  const layer = transport.layer({ maxRequestBytes: 1024, content: false }).pipe(
    Layer.provide(host.layer),
    Layer.provide(logs.layer)
  )
  const statuses = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const held = yield* Effect.forEach([1, 2, 3, 4], () => Effect.forkChild(post(10)))
      yield* Effect.yieldNow
      while (host.sent.length < 4) yield* Effect.yieldNow
      const fifth = (yield* post(10)).status
      yield* Deferred.succeed(gate, undefined)
      const rest = yield* Effect.forEach(held, (fiber) => Effect.map(Fiber.join(fiber), (answer) => answer.status))
      return [...rest, fifth]
    }),
    layer
  ))
  expect(statuses).toEqual([200, 200, 200, 200, 204])
  expect(host.sent).toHaveLength(4)
  expect(logs.warnings.some((warning) => warning.annotations["reason"] === "saturated")).toBe(true)
})

test("VIP-72 rule 4: a request stalled for ten seconds is discarded", async () => {
  const host = collector(() => Effect.never)
  const logs = capturing()
  const layer = transport.layer({ maxRequestBytes: 1024, content: false }).pipe(
    Layer.provide(host.layer),
    Layer.provide(logs.layer)
  )
  const status = await Effect.runPromise(Effect.provide(
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(post(10))
      while (host.sent.length < 1) yield* Effect.yieldNow
      yield* TestClock.adjust("10 seconds")
      return (yield* Fiber.join(fiber)).status
    }),
    Layer.merge(layer, TestClock.layer())
  ))
  expect(status).toBe(204)
  expect(logs.warnings.some((warning) => warning.annotations["reason"] === "stalled")).toBe(true)
})

test("VIP-72: relay forwards a browser's export scrubbed, with the collector's credential added", async () => {
  const host = collector(() => Effect.succeed(new Response(null, { status: 202 })))
  const handler = await Effect.runPromise(Otlp.relay({
    url: "https://collector.example.com/otlp",
    headers: { authorization: "Bearer collector-key" },
    maxBodyBytes: 2048
  }))
  const call = (init: { readonly method?: string; readonly path?: string; readonly type?: string; readonly body?: string }) =>
    Effect.runPromise(Effect.provide(
      Effect.map(
        handler(HttpServerRequest.fromWeb(new Request(`https://app.example.com${init.path ?? "/telemetry/v1/traces"}`, {
          method: init.method ?? "POST",
          headers: { "content-type": init.type ?? "application/json" },
          ...(init.method === "GET" ? {} : { body: init.body ?? "{}" })
        }))),
        (response) => HttpServerResponse.toWeb(response).status
      ),
      host.layer
    ))
  const payload = JSON.stringify({
    resourceSpans: [{ attributes: [{ key: "password", value: { stringValue: "hunter22" } }], note: `token=${SECRET}` }]
  })
  expect(await call({ body: payload })).toBe(202)
  expect(host.sent).toHaveLength(1)
  expect(host.sent[0]!.url).toBe("https://collector.example.com/otlp/v1/traces")
  expect(host.sent[0]!.headers["authorization"]).toBe("Bearer collector-key")
  expect(host.sent[0]!.body).not.toContain("hunter22")
  expect(host.sent[0]!.body).not.toContain(SECRET)
  expect(await call({ method: "GET" })).toBe(405)
  expect(await call({ path: "/telemetry/v1/profiles" })).toBe(404)
  expect(await call({ type: "application/x-protobuf" })).toBe(415)
  expect(await call({ body: JSON.stringify({ pad: "x".repeat(4096) }) })).toBe(413)
  expect(await call({ body: "{not json" })).toBe(400)
  expect(host.sent).toHaveLength(1)
})

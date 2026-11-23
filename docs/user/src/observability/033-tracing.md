# Tracing

Tracing records how long operations take and how they nest across sequential calls, concurrent fibers, and service boundaries. Functions are untraced by default; wrap the operations worth observing with `withSpan` and attach an exporter layer at the application boundary.

![Built-in observability: Logging, Metrics, and Tracing](/diagrams/observability-pillars.svg)

## Relating spans to traces

```vibe
// run: const spans: Tracer.NativeSpan[] = []; const tracer = Tracer.make({ span(options) { const span = new Tracer.NativeSpan(options); spans.push(span); return span } }); try Console.log(try withTracer(requestTrace(), tracer)); try Console.log(spans[0].name, spans[0].status._tag, Option.isNone(spans[0].parent))
effect function requestTrace() {
  return try withSpan(effect {
    try sleep("10 millis")
    return "response"
  }, "report-request")
}

effect function stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}

```

```output
response
report-request Ended true
```

A **span** records one timed operation: name, span ID, optional parent span ID, timestamps, exit status, events, and attributes. A **trace** groups all spans sharing a root trace ID into a parent-child tree rendered as a waterfall in trace viewers.

## Adding spans around computations

```vibe
// run: const spans: Tracer.NativeSpan[] = []; const tracer = Tracer.make({ span(options) { const span = new Tracer.NativeSpan(options); spans.push(span); return span } }); try Console.log(try withTracer(renderReport("csv"), tracer)); try Console.log(spans[0].name, spans[0].attributes.get("report.format"), spans[0].status._tag)
effect function renderReport(format: string) {
  return try withSpan(effect {
    try sleep("20 millis")
    return `report.${format}`
  }, "render-report", { attributes: { "report.format": format } })
}
// string!!
```

```output
report.csv
render-report csv Ended
```

`withSpan` starts a span before executing its Effect and closes it on every exit (success, failure, defect, or interruption) without changing the return value or error channel. Keep span names low-cardinality (`"render-report"`) so traces aggregate cleanly; put variable data (`format`, IDs) in `attributes`.

## Exporting spans and SDK boundaries

Keep browser or platform Web API fixtures in a `.ts` adapter and inject them through `FetchHttpClient.Fetch`:

```ts
// collector.ts
/** @throws {never} */
export function collectorFixture() {
  const requests: unknown[] = []
  const collector: typeof globalThis.fetch = (_input, init) => {
    requests.push(JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)))
    return Promise.resolve(new Response(null, { status: 200 }))
  }
  return { requests, collector }
}
```

```vibe
// run: const { requests, collector } = collectorFixture(); try Console.log(try provideService(exportedReport(), FetchHttpClient.Fetch, collector)); try Console.log(requests.length, (try stringify(requests)).includes("render-report"), (try stringify(requests)).includes("report-worker"))
import { collectorFixture } from "./collector.ts"

const Tracing = OtlpTracer.layer({
  url: "http://localhost:4318/v1/traces",
  resource: { serviceName: "report-worker" },
  exportInterval: "1 second"
})
  |> Layer.provide(%, OtlpSerialization.layerJson)
  |> Layer.provide(%, FetchHttpClient.layer)

effect function exportedReport() {
  provide Tracing { return try renderReport("csv") }
}
```

```output
report.csv
1 true true
```

Effect 4.1.1 ships OTLP/HTTP export directly under `effect/observability`. `OtlpTracer.layer` batches ended spans, transmits them through the provided HTTP client and serializer, and flushes pending spans when its scope closes. Install `Tracing` once at the application lifetime (or in a `ManagedRuntime`) rather than per request.

When integrating with an existing OpenTelemetry SDK tracer provider, wire its bridge in a TypeScript bootstrap module and hand the resulting `Layer` to VibeLang. Wrap throwing synchronous SDK calls with `Effect.try` and Promises with `tryPromise`; synchronous SDK context callbacks compile to plain JavaScript and cannot invoke Effect operations or services.

## Inspecting failures and attributes

```vibe
// run: const spans: Tracer.NativeSpan[] = []; const tracer = Tracer.make({ span(options) { const span = new Tracer.NativeSpan(options); spans.push(span); return span } }); const outcome = try withTracer(Effect.provide(failingRender(), Logger.layer([])), tracer); try Console.log(Exit.isFailure(outcome), spans[0].attributes.get("report.format")); if (spans[0].status._tag === "Ended") try Console.log(Exit.isFailure(spans[0].status.exit))
error RenderFailed {
  format: string
}

effect function failingRender() {
  const outcome = try exit(withSpan(effect {
    try annotateCurrentSpan("report.format", "unknown")
    throw new RenderFailed({ format: "unknown" })
  }, "render-report"))
  if (Exit.isFailure(outcome)) try logError("render failed", outcome.cause)
  return outcome
}
```

```output
true unknown
true
```

Failed spans automatically capture error status and the failure cause. Call `try annotateCurrentSpan(key, value)` from anywhere inside the span to attach context discovered mid-flight. Wrapping `withSpan(...)` in `exit(...)` lets a boundary inspect the `Exit` without hiding the failure from the span.

## Representing logs as span events

```vibe
// run: const spans: Tracer.NativeSpan[] = []; const tracer = Tracer.make({ span(options) { const span = new Tracer.NativeSpan(options); spans.push(span); return span } }); const original = try Console.Console; try withTracer(provideService(tracedLogs(), Console.Console, { ...original, log: () => {} }), tracer); try Console.log(try stringify(spans[0].events.map(([name]) => name)), spans[0].status._tag)
effect function tracedLogs() {
  provide Logger.layer([Logger.defaultLogger, Logger.tracerLogger]) {
    try withSpan(effect {
      try logInfo("input validated")
      try sleep("10 millis")
      try logInfo("artifact written")
    }, "generate-artifact")
  }
}
```

```output
["input validated","artifact written"] Ended
```

`Logger.tracerLogger` mirrors log records emitted inside an active span as timestamped span events. If you install a custom `Logger.layer([...])`, keep `Logger.tracerLogger` in the list to preserve this bridge.

## Nesting operations

```vibe
// run: const spans: Tracer.NativeSpan[] = []; const tracer = Tracer.make({ span(options) { const span = new Tracer.NativeSpan(options); spans.push(span); return span } }); { const jsonValue = try withTracer(generate(), tracer); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = spans.map((span) => [span.name, Option.getOrElse(Option.map(span.parent, (parent) => parent.spanId === spans[0].spanId), () => false), span.traceId === spans[0].traceId, span.status._tag]); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function loadTemplate() {
  return try withSpan(effect {
    try sleep("10 millis")
    return "weekly-template"
  }, "load-template")
}

effect function generate() {
  return try withSpan(effect {
    const template = try loadTemplate()
    const output = try renderReport("csv")
    return { template, output }
  }, "generate-report")
}
```

```output
{"template":"weekly-template","output":"report.csv"}
[["generate-report",false,true,"Ended"],["load-template",true,true,"Ended"],["render-report",true,true,"Ended"]]
```

Inner `withSpan` calls automatically inherit the active span as their parent and share its trace ID. Forked child fibers inherit the active span too, placing concurrent branches side by side in the same waterfall.

## Viewing traces locally

```vibe
// run: const { requests, collector } = collectorFixture(); try provideService(demonstration(), FetchHttpClient.Fetch, collector); try Console.log(requests.length, (try stringify(requests)).includes("generate-report"), (try stringify(requests)).includes("load-template"), (try stringify(requests)).includes("render-report"))
import { collectorFixture } from "./collector.ts"

effect function demonstration() {
  provide Tracing { try generate() }
}
```

```output
1 true true true
```

To inspect traces locally, start a Grafana LGTM stack (OTLP collector, Tempo, and Grafana):

`docker run --rm --name vibelang-telemetry --publish 3000:3000 --publish 4318:4318 grafana/otel-lgtm`

Once the stack is ready, run `demonstration` through your application runner so the exporter flushes on shutdown. Open `http://localhost:3000/explore`, sign in using the container's startup credentials, and query Tempo for service `report-worker` (allowing a moment for indexing). Open a `generate-report` trace to inspect parent/child timings, attributes, events, and error statuses. If traces are missing, verify the OTLP URL, HTTP client layer, serialization layer, and exporter logs first.

## Connecting external tracing services

```vibe
// run: const { requests, collector } = collectorFixture(); provide ConfigProvider.layer(ConfigProvider.fromUnknown({ TRACE_ENDPOINT: "http://collector.invalid/v1/traces" })) { { const jsonValue = try provideService(productionReport(), FetchHttpClient.Fetch, collector); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } }; try Console.log(requests.length, (try stringify(requests)).includes("generate-report"))
import { collectorFixture } from "./collector.ts"

const TraceEndpoint = Config.String("TRACE_ENDPOINT")

const VendorTracing = Layer.unwrap(effect {
  const url = try TraceEndpoint
  return OtlpTracer.layer({ url, resource: { serviceName: "report-worker" } })
    |> Layer.provide(%, OtlpSerialization.layerJson)
    |> Layer.provide(%, FetchHttpClient.layer)
})

effect function productionReport() {
  provide VendorTracing { return try generate() }
}
```

```output
{"template":"weekly-template","output":"report.csv"}
1 true
```

Read `TRACE_ENDPOINT` via `Config` inside `Layer.unwrap` so environments supply their own collector URL and auth headers via `OtlpTracer.layer`. Point directly at a vendor's OTLP endpoint or an intermediate OpenTelemetry Collector. For services with proprietary SDKs (such as Sentry), connect through their documented OTLP endpoint or compatible SDK bridge; successful spans do not generate error alerts.

## Coming from Effect

Tracing in VibeLang is explicit: wrap operations with `try withSpan(program, "name")`, using `effect { ... }` for multi-statement spans. The compiler does not auto-span every function—place spans on meaningful operational boundaries instead of mirroring every helper call.

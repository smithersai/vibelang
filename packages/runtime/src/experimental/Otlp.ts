/**
 * Logs, metrics and traces over OTLP, scrubbed and bounded (VIP-72).
 *
 * Logging, tracing and metrics are Effect's: `logInfo`, `withSpan` and
 * `Metric.counter` already work, and Effect's `Otlp.layerJson` already sends
 * all three to a collector. {@link layer} is that same exporter with two
 * properties an agentic program needs on top:
 *
 * ```ts
 * provide Experimental.Otlp.layer({ url: "http://localhost:4318", service: "triage" }) {
 *   try withSpan(logInfo("triage started"), "triage")
 * }
 * ```
 *
 * Rules:
 *
 * 1. **Removing the layer removes telemetry and changes nothing else.** An
 *    export that fails never fails or retries the step that logged.
 * 2. **Records are scrubbed before export.** Every string a log record, a
 *    span or a metric carries passes the journal's redaction rules, and an
 *    attribute whose key names a credential becomes `[REDACTED]`.
 * 3. **A resource is validated when the layer is built.** Identity fields
 *    and attribute keys hold at most 1,024 UTF-16 code units; a bad resource
 *    fails with {@link InvalidResourceConfiguration}.
 * 4. **The transport is capped at 1 MiB a request.** A batch over the cap,
 *    stalled for ten seconds, or beyond four requests in flight is
 *    discarded, counted on {@link dropped}, and reported by one `Warn` log
 *    with code `otlp_export_discarded` and a reason (`oversized`, `stalled`
 *    or `saturated`) at most once a minute, through the loggers that were
 *    installed before the exporter. The warning never enters the exporter.
 * 5. **Ambient resource configuration is ignored.** `OTEL_RESOURCE_ATTRIBUTES`
 *    cannot enlarge a resource after it was validated.
 * 6. **No SDK.** Effect's exporter and `HttpClient`; no `node:` built-in.
 * 8. **Content is off by default.** Prompt, completion, message, tool
 *    argument and result attributes (`gen_ai.prompt…`, `vibe.content…`) are
 *    removed unless the layer is told `content: true`.
 *
 * Ported from the reference engine's observability package (`Otlp.layer`,
 * `Resource`, `Endpoint`, `OtlpRelay`).
 *
 * @since 0.0.14
 */
import * as ConfigProvider from "effect/ConfigProvider"
import * as Data from "effect/Data"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Metric from "effect/Metric"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Headers from "effect/http/Headers"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as EffectOtlp from "effect/observability/Otlp"
import type * as OtlpExporter from "effect/observability/OtlpExporter"
import * as redaction from "./internal/otlpRedaction.js"
import * as transport from "./internal/otlpTransport.js"

/**
 * @since 0.0.14
 */
export type TypeId = "~vibelang/experimental/Otlp"

/**
 * @since 0.0.14
 */
export const TypeId: TypeId = "~vibelang/experimental/Otlp"

/**
 * The largest export request, in encoded bytes: 1 MiB.
 *
 * @category transport
 * @since 0.0.14
 */
export const maxRequestBytes: number = transport.maxRequestBytes

/**
 * The most UTF-16 code units an identity field or attribute key holds.
 *
 * @category resource
 * @since 0.0.14
 */
export const maximumFieldLength = 1024

/**
 * The most bytes a resource encodes to as JSON: 128 KiB, so every request
 * keeps room for its batch.
 *
 * @category resource
 * @since 0.0.14
 */
export const maximumResourceBytes = 128 * 1024

/**
 * The most export requests in flight at once. A batch beyond them is
 * discarded as `saturated`; nothing queues.
 *
 * @category transport
 * @since 0.0.14
 */
export const maxInFlight: number = transport.maxInFlight

const maxBatchSize = 1000

/**
 * Why a batch was discarded.
 *
 * @category transport
 * @since 0.0.14
 */
export type DiscardReason = transport.DiscardReason

/**
 * The counter of discarded export batches. It is exported through the same
 * transport it describes, so a sustained outage also loses it; the warning
 * log is the signal that survives.
 *
 * @category transport
 * @since 0.0.14
 */
export const dropped: Metric.Counter<number> = transport.dropped

/**
 * A resource that cannot be exported. `path` names the field; the message
 * names the rule, never a value.
 *
 * @category errors
 * @since 0.0.14
 */
export class InvalidResourceConfiguration extends Data.TaggedError("InvalidResourceConfiguration")<{
  readonly path: string
  readonly reason: string
}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return `invalid OTLP resource at ${this.path}: ${this.reason}`
  }
}

/**
 * A collector URL that cannot be exported to.
 *
 * @category errors
 * @since 0.0.14
 */
export class InvalidExporterEndpoint extends Data.TaggedError("InvalidExporterEndpoint")<{
  readonly reason: string
}> {
  /**
   * @since 0.0.14
   */
  override get message(): string {
    return `invalid OTLP endpoint: ${this.reason}`
  }
}

/**
 * How {@link layer} exports.
 *
 * @category models
 * @since 0.0.14
 */
export interface Options {
  /**
   * The collector base URL, such as `http://localhost:4318`. Signals go to
   * `/v1/logs`, `/v1/metrics` and `/v1/traces` below it. An absolute
   * `http:` or `https:` URL with no credentials, query or fragment.
   */
  readonly url: string
  /** The `service.name` resource attribute. */
  readonly service: string
  /** The `service.version` resource attribute. */
  readonly version?: string | undefined
  /** More resource attributes: strings, finite numbers, booleans, or arrays of one of them. */
  readonly attributes?: Readonly<Record<string, unknown>> | undefined
  /**
   * Headers sent with every export. A header that names a credential
   * requires an `https:` URL unless the collector is on this machine.
   */
  readonly headers?: Headers.Input | undefined
  /** Export prompts, completions, messages and tool content (VIP-72 rule 8). Off by default. */
  readonly content?: boolean | undefined
  /** At most, and by default, {@link maxRequestBytes}. */
  readonly maxRequestBytes?: number | undefined
  /** Export cadence for all three signals; Effect's default for each when omitted. */
  readonly exportInterval?: Duration.Input | undefined
  /** Upper bound on the flush when the layer's scope closes. */
  readonly shutdownTimeout?: Duration.Input | undefined
}

/**
 * A validated resource.
 *
 * @category resource
 * @since 0.0.14
 */
export interface Resource {
  readonly serviceName: string
  readonly serviceVersion?: string | undefined
  readonly attributes: Readonly<Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>>>
}

// eslint-disable-next-line no-control-regex
const control = /[\u0000-\u001f\u007f]/

const fieldProblem = (value: unknown, required: boolean): string | undefined => {
  if (value === undefined) return required ? "is required" : undefined
  if (typeof value !== "string") return "is a string"
  if (value.length === 0) return "is not empty"
  if (value.length > maximumFieldLength) return `holds at most ${maximumFieldLength} UTF-16 code units`
  if (control.test(value)) return "holds no control character"
  return undefined
}

const primitive = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))

/**
 * Validates a resource as {@link layer} does when it is built.
 *
 * @category resource
 * @since 0.0.14
 */
export const resource = (input: {
  readonly service: string
  readonly version?: string | undefined
  readonly attributes?: Readonly<Record<string, unknown>> | undefined
}): Effect.Effect<Resource, InvalidResourceConfiguration> =>
  Effect.suspend(() => {
    const fail = (path: string, reason: string) => Effect.fail(new InvalidResourceConfiguration({ path, reason }))
    const service = fieldProblem(input.service, true)
    if (service !== undefined) return fail("service", service)
    const version = fieldProblem(input.version, false)
    if (version !== undefined) return fail("version", version)
    const attributes: Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>> = {}
    for (const [key, value] of Object.entries(input.attributes ?? {})) {
      const keyProblem = fieldProblem(key, true)
      if (keyProblem !== undefined) return fail("attributes", `a key ${keyProblem}`)
      if (key === "service.name" || key === "service.version") {
        return fail(`attributes.${key}`, "is set by service and version")
      }
      if (primitive(value)) {
        attributes[key] = value
        continue
      }
      if (Array.isArray(value) && value.every(primitive) && new Set(value.map((item) => typeof item)).size <= 1) {
        attributes[key] = [...value]
        continue
      }
      return fail(`attributes.${key.slice(0, 64)}`, "is a string, a finite number, a boolean, or an array of one of them")
    }
    const decoded: Resource = {
      serviceName: input.service,
      ...(input.version === undefined ? {} : { serviceVersion: input.version }),
      attributes
    }
    if (new TextEncoder().encode(JSON.stringify(decoded)).length > maximumResourceBytes) {
      return fail("attributes", `the resource encodes to at most ${maximumResourceBytes} bytes`)
    }
    return Effect.succeed(decoded)
  })

const loopbackIpv4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "[::1]" || loopbackIpv4.test(hostname)

const vendorCredentialHeaders: ReadonlySet<string> = new Set(["x-honeycomb-team"])

/**
 * Validates a collector URL: absolute `http:` or `https:`, no credentials,
 * query, fragment, backslash, space or control. A trailing `/` is dropped.
 *
 * @category transport
 * @since 0.0.14
 */
export const endpoint = (
  url: string,
  headers?: Headers.Input | undefined
): Effect.Effect<string, InvalidExporterEndpoint> =>
  Effect.suspend(() => {
    const fail = (reason: string) => Effect.fail(new InvalidExporterEndpoint({ reason }))
    if (typeof url !== "string" || /[\s\\]/.test(url) || control.test(url)) {
      return fail("the URL holds no space, backslash or control character")
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return fail("the URL is absolute")
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("the URL is http: or https:")
    if (parsed.username !== "" || parsed.password !== "") return fail("the URL holds no credentials; use headers")
    if (parsed.search !== "" || parsed.hash !== "" || url.includes("?") || url.includes("#")) {
      return fail("the URL holds no query or fragment")
    }
    const names = Object.keys(Headers.fromInput(headers))
    const credential = names.some((name) => redaction.isSensitiveKey(name) || vendorCredentialHeaders.has(name))
    if (credential && parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
      return fail("a credential header needs an https: URL unless the collector is on this machine")
    }
    return Effect.succeed(parsed.href.replace(/\/+$/, ""))
  })

/**
 * `text` with every credential shape the redaction rules know replaced by
 * `[REDACTED]` or a named marker. The rules {@link layer} applies to every
 * exported string.
 *
 * @category scrubbing
 * @since 0.0.14
 */
export const redact = (text: string): string => redaction.redactText(text)

/**
 * An OTLP JSON payload as {@link layer} exports it: every string redacted,
 * every attribute whose key names a credential replaced, and content
 * attributes removed unless `content` is set.
 *
 * @category scrubbing
 * @since 0.0.14
 */
export const scrubPayload = (payload: unknown, options?: { readonly content?: boolean | undefined }): unknown =>
  redaction.redactPayload(payload, { content: options?.content === true })

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * A layer that exports logs, metrics and traces over OTLP/HTTP as JSON,
 * scrubbed and bounded. It provides Effect's `Flusher`, so a host can flush
 * before it exits. It requires an `HttpClient`.
 *
 * @category layers
 * @since 0.0.14
 */
export const layer = (
  options: Options
): Layer.Layer<
  OtlpExporter.Flusher,
  InvalidResourceConfiguration | InvalidExporterEndpoint,
  HttpClient.HttpClient
> =>
  Layer.unwrap(
    Effect.map(
      Effect.all([
        resource({ service: options.service, version: options.version, attributes: options.attributes }),
        endpoint(options.url, options.headers)
      ]),
      ([decoded, baseUrl]) =>
        EffectOtlp.layerJson({
          baseUrl,
          resource: {
            serviceName: decoded.serviceName,
            ...(decoded.serviceVersion === undefined ? {} : { serviceVersion: decoded.serviceVersion }),
            attributes: { ...decoded.attributes }
          },
          headers: options.headers,
          maxBatchSize,
          loggerExportInterval: options.exportInterval,
          metricsExportInterval: options.exportInterval,
          tracerExportInterval: options.exportInterval,
          shutdownTimeout: options.shutdownTimeout
        }).pipe(
          Layer.provide(transport.layer({
            maxRequestBytes: Math.max(1, Math.min(options.maxRequestBytes ?? maxRequestBytes, maxRequestBytes)),
            content: options.content === true
          })),
          // Effect merges OTEL_RESOURCE_ATTRIBUTES even with explicit options.
          // Keep unvalidated ambient metadata out of every request.
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
        )
    )
  )

/**
 * How {@link relay} forwards a browser's exports.
 *
 * @category relay
 * @since 0.0.14
 */
export interface RelayOptions {
  /** The collector base URL the relay forwards to. */
  readonly url: string
  /** Headers added to every forwarded request, such as the collector's credential. */
  readonly headers?: Headers.Input | undefined
  /** The largest body the relay accepts: at most, and by default, {@link maxRequestBytes}. */
  readonly maxBodyBytes?: number | undefined
  /** Forward content attributes (VIP-72 rule 8). Off by default. */
  readonly content?: boolean | undefined
}

const signals: ReadonlySet<string> = new Set(["logs", "metrics", "traces"])

class TooLarge extends Data.TaggedError("TooLarge")<{}> {}

/**
 * An HTTP handler that receives a browser's OTLP/JSON exports on your own
 * route, ending in `/v1/logs`, `/v1/metrics` or `/v1/traces`, scrubs them
 * as {@link layer} does, and forwards them to the collector. It answers the
 * collector's status with no body: 405 for a method other than `POST`, 404
 * for another path, 415 for a body that is not JSON, 413 for one over the
 * limit, 400 for one that does not parse, and 502 when the collector does
 * not answer. The collector's credential stays on the server.
 *
 * Fails to build with {@link InvalidExporterEndpoint} for a bad URL.
 *
 * @category relay
 * @since 0.0.14
 */
export const relay = (
  options: RelayOptions
): Effect.Effect<
  (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpClient.HttpClient>,
  InvalidExporterEndpoint
> =>
  Effect.map(endpoint(options.url, options.headers), (baseUrl) => {
    const limit = Math.max(1, Math.min(options.maxBodyBytes ?? maxRequestBytes, maxRequestBytes))
    const content = options.content === true
    const status = (code: number) => HttpServerResponse.empty({ status: code })
    return (request) =>
      Effect.gen(function*() {
        if (request.method !== "POST") return status(405)
        const path = request.url.split("?")[0]!
        const match = /\/v1\/([a-z]+)$/.exec(path)
        if (match === null || !signals.has(match[1]!)) return status(404)
        if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return status(415)
        const declared = Number(request.headers["content-length"] ?? "0")
        if (Number.isFinite(declared) && declared > limit) return status(413)
        const chunks: Array<Uint8Array> = []
        let total = 0
        const read = yield* Stream.runForEach(request.stream, (chunk) => {
          total += chunk.length
          if (total > limit) return Effect.fail(new TooLarge())
          chunks.push(chunk)
          return Effect.void
        }).pipe(
          Effect.map(() => "read" as const),
          Effect.catchTag("TooLarge", () => Effect.succeed("large" as const)),
          Effect.orElseSucceed(() => "broken" as const)
        )
        if (read === "large") return status(413)
        if (read === "broken") return status(400)
        const body = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          body.set(chunk, offset)
          offset += chunk.length
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(decoder.decode(body))
        } catch {
          return status(400)
        }
        const scrubbed = encoder.encode(JSON.stringify(redaction.redactPayload(parsed, { content })))
        const client = yield* HttpClient.HttpClient
        const forwarded = HttpClientRequest.post(`${baseUrl}/v1/${match[1]}`, { headers: options.headers }).pipe(
          HttpClientRequest.bodyUint8Array(scrubbed, "application/json")
        )
        return yield* client.execute(forwarded).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
          Effect.map((answer) => status(answer.status)),
          Effect.scoped,
          Effect.orElseSucceed(() => status(502))
        )
      })
  })

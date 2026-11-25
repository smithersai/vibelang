/**
 * The bounded, scrubbing transport under `Experimental.Otlp.layer`
 * (VIP-72 rules 2 and 4). Ported from the reference engine's
 * `Otlp.boundedClient`, without splitting: a batch over the cap is
 * discarded whole.
 *
 * @internal
 */
import { Clock } from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as References from "effect/References"
import * as Semaphore from "effect/Semaphore"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as redaction from "./otlpRedaction.js"

export const maxRequestBytes = 1024 * 1024
export const maxInFlight = 4
export const requestTimeout = "10 seconds"
export const diagnosticIntervalMillis = 60_000

export type DiscardReason = "oversized" | "stalled" | "saturated"

export const dropped: Metric.Counter<number> = Metric.counter("flows_observability_otlp_dropped", {
  description: "OTLP export batches discarded by the bounded transport",
  incremental: true
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** An OTLP JSON body scrubbed, or the text scrubbed when it is not JSON. */
export const scrubBody = (body: Uint8Array, content: boolean): Uint8Array => {
  const text = decoder.decode(body)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return encoder.encode(redaction.redactText(text))
  }
  return encoder.encode(JSON.stringify(redaction.redactPayload(parsed, { content })))
}

/**
 * A collector's answer reduced to its status and `retry-after`, with no
 * body, so a collector that never ends its answer cannot stall a signal.
 */
const withoutBody = (response: HttpClientResponse.HttpClientResponse): HttpClientResponse.HttpClientResponse => {
  const retryAfter = response.headers["retry-after"]
  let answer: Response
  try {
    answer = new Response(null, {
      status: response.status,
      headers: retryAfter === undefined ? {} : { "retry-after": retryAfter }
    })
  } catch {
    answer = Response.error()
  }
  return HttpClientResponse.fromWeb(response.request, answer)
}

export const layer = (limits: { readonly maxRequestBytes: number; readonly content: boolean }) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function*() {
      const client = HttpClient.transformResponse(
        HttpClient.withScope(yield* HttpClient.HttpClient),
        (exchange) => exchange.pipe(Effect.map(withoutBody), Effect.scoped)
      )
      const clock = yield* Clock
      // The loggers installed before the exporter exists: a diagnostic pinned
      // to them can never enter the exporter it describes.
      const ambientLoggers = yield* Effect.withFiber((fiber) => Effect.succeed(fiber.getRef(Logger.CurrentLoggers)))
      const permits = Semaphore.makeUnsafe(maxInFlight)
      let nextDiagnosticAt = -Infinity
      // A discard answers 204, so the exporter neither keeps nor retries the batch.
      const discard = (reason: DiscardReason, request: HttpClientRequest.HttpClientRequest, bytes: number) =>
        Metric.update(dropped, 1).pipe(
          Effect.andThen(Effect.suspend(() => {
            const now = clock.currentTimeMillisUnsafe()
            if (now < nextDiagnosticAt) return Effect.void
            nextDiagnosticAt = now + diagnosticIntervalMillis
            return Metric.value(dropped).pipe(
              Effect.flatMap((total) =>
                Effect.logWarning("An OTLP export batch was discarded").pipe(
                  Effect.provideService(References.CurrentLogSpans, []),
                  Effect.provideService(References.CurrentLogAnnotations, {
                    code: "otlp_export_discarded",
                    reason,
                    bytes,
                    limit: limits.maxRequestBytes,
                    dropped: total.count
                  })
                )
              ),
              Effect.provideService(Logger.CurrentLoggers, ambientLoggers)
            )
          })),
          Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })))
        )
      // A redirect is refused: no signal or credential leaves the configured endpoint.
      const confined = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (init) =>
          Effect.provideService(effect, FetchHttpClient.RequestInit, {
            ...Option.getOrUndefined(init),
            redirect: "manual"
          }))
      return HttpClient.transform(client, (_unscrubbed, request) =>
        Effect.suspend(() => {
          const raw = request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array(0)
          const body = scrubBody(raw, limits.content)
          if (body.length > limits.maxRequestBytes) return discard("oversized", request, body.length)
          const scrubbed = HttpClientRequest.bodyUint8Array(request, body, "application/json")
          return confined(client.execute(scrubbed)).pipe(
            Effect.timeoutOrElse({
              duration: requestTimeout,
              orElse: () => discard("stalled", scrubbed, body.length)
            }),
            permits.withPermitsIfAvailable(1),
            Effect.flatMap(Option.match({
              onNone: () => discard("saturated", scrubbed, body.length),
              onSome: Effect.succeed
            }))
          )
        }))
    })
  )


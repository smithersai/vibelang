/**
 * Worker adapter: Effect's Dns.make owns discovery/records; the extension
 * adds direct TCP TXT with RD=0 and mandatory AA. No recursive TXT fallback.
 * @experimental
 * @since 0.0.12
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Dns as EffectDns, Host, NetAddress } from "effect/net"
import * as Dns from "../Dns.js"
import * as wire from "../internal/dnsWire.js"

/** The structural Cloudflare TCP socket API used here. @since 0.0.12 */
export interface Socket {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  readonly closed: Promise<unknown>
  readonly close: () => Promise<unknown>
}

/** Inject another Worker's TCP adapter, or a fake. @since 0.0.12 */
export interface Options {
  readonly connect: (address: { readonly hostname: string; readonly port: number }) => Socket | Promise<Socket>
  readonly discoveryUrl?: string
  readonly timeout?: number
}

const error = (operation: "resolveTxtAt", reason: Dns.AuthoritativeDnsError["reason"], message: string) =>
  new Dns.AuthoritativeDnsError({ operation, reason, message })

/** Provides Effect's key and the extended key from one implementation. @since 0.0.12 */
export const layerWith = (options: Options): Layer.Layer<Dns.Dns | EffectDns.Dns, never, HttpClient.HttpClient> =>
  Layer.effectContext(Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const bounded = <A>(operation: "resolveTxtAt", effect: Effect.Effect<A, Dns.AuthoritativeDnsError>) =>
      Effect.timeoutOrElse(effect, {
        duration: options.timeout ?? 3000,
        orElse: () => Effect.fail(error(operation, "Timeout", "DNS operation timed out"))
      })
    // This is a platform implementation of Effect's existing service, not a
    // second API for NS/A resolution or a replacement for its record model.
    const discovery = (name: string, type: EffectDns.RecordType) => {
      const fail = (reason: EffectDns.DnsErrorReason) => new EffectDns.DnsError({
        method: "resolve", hostname: name, recordType: type, reason
      })
      return Effect.timeoutOrElse(Effect.gen(function*() {
        if (type !== "NS" && type !== "A") return yield* Effect.fail(fail("Unsupported"))
        const response = yield* client.execute(HttpClientRequest.get(options.discoveryUrl ?? "https://cloudflare-dns.com/dns-query").pipe(
          HttpClientRequest.setUrlParams({ name, type }),
          HttpClientRequest.setHeader("Accept", "application/dns-json")
        )).pipe(Effect.mapError(() => fail("Refused")))
        if (response.status !== 200) return yield* Effect.fail(fail("Refused"))
        const body: unknown = yield* response.json.pipe(Effect.mapError(() => fail("InvalidResponse")))
        if (typeof body !== "object" || body === null || !("Status" in body)) return yield* Effect.fail(fail("InvalidResponse"))
        if (body.Status === 3) return yield* Effect.fail(fail("NotFound"))
        if (body.Status !== 0) return yield* Effect.fail(fail("ServerFailure"))
        const answers = "Answer" in body ? body.Answer : []
        if (!Array.isArray(answers)) return yield* Effect.fail(fail("InvalidResponse"))
        const records: EffectDns.DnsRecord[] = []
        for (const answer of answers) {
          if (answer !== null && typeof answer === "object" && answer.type === (type === "NS" ? 2 : 1)) {
            if (typeof answer.data !== "string") return yield* Effect.fail(fail("InvalidResponse"))
            if (type === "NS") {
              const host = yield* Effect.fromResult(Host.domainNameFromString(answer.data.endsWith(".") ? answer.data : answer.data + ".")).pipe(Effect.mapError(() => fail("InvalidResponse")))
              records.push(yield* Effect.fromResult(EffectDns.makeRecord("NS", { host })).pipe(Effect.mapError(() => fail("InvalidResponse"))))
            } else {
              const address = yield* Effect.fromResult(NetAddress.ipFromString(answer.data)).pipe(Effect.mapError(() => fail("InvalidResponse")))
              if (!NetAddress.isIpv4Address(address)) return yield* Effect.fail(fail("InvalidResponse"))
              records.push(yield* Effect.fromResult(EffectDns.makeRecord("A", { address })).pipe(Effect.mapError(() => fail("InvalidResponse"))))
            }
          }
        }
        return records
      }), { duration: options.timeout ?? 3000, orElse: () => Effect.fail(fail("Timeout")) })
    }
    const base = EffectDns.make({
      lookup: (name) => Effect.map(discovery(name, "A"), (records) => records.flatMap((record) => record._tag === "A" ? [record.address] : [])),
      resolve: discovery
    })
    const service = Dns.make(base, (server, name) => bounded("resolveTxtAt", Effect.gen(function*() {
        // Discovery returns IPs; never ask a recursive DNS server for TXT here.
        yield* Effect.fromResult(NetAddress.ipFromString(server)).pipe(Effect.mapError(() =>
          error("resolveTxtAt", "BadArgument", "Nameserver must be an IP address")))
        // Each socket has exactly one query, so a fixed transaction id is unambiguous.
        const request = yield* Effect.fromResult(wire.query(name, 0))
        return yield* Effect.tryPromise({
          try: async (signal) => {
            const socket = await options.connect({ hostname: server, port: 53 })
            let closed = false
            const close = () => {
              if (closed) return
              closed = true
              try { void socket.close().catch(() => {}) } catch { /* Cleanup cannot expose a host exception. */ }
            }
            void socket.closed.catch(() => {})
            signal.addEventListener("abort", close, { once: true })
            if (signal.aborted) { close(); throw error("resolveTxtAt", "Transport", "DNS query interrupted") }
            let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
            let writer: WritableStreamDefaultWriter<Uint8Array> | undefined
            try {
              reader = socket.readable.getReader()
              writer = socket.writable.getWriter()
              const frame = new Uint8Array(request.length + 2)
              new DataView(frame.buffer).setUint16(0, request.length)
              frame.set(request, 2)
              await writer.write(frame)
              // One DNS-over-TCP response frame, bounded by its 16-bit length.
              const buffer = new Uint8Array(65537)
              let length = 0
              let expected: number | undefined
              while (expected === undefined || length < expected) {
                const chunk = await reader.read()
                if (chunk.done) throw error("resolveTxtAt", "InvalidData", "DNS socket closed before a complete frame")
                if (length + chunk.value.length > buffer.length) throw error("resolveTxtAt", "InvalidData", "DNS frame too large")
                buffer.set(chunk.value, length)
                length += chunk.value.length
                if (length >= 2 && expected === undefined) {
                  expected = new DataView(buffer.buffer).getUint16(0) + 2
                  if (expected < 14) throw error("resolveTxtAt", "InvalidData", "DNS frame too short")
                }
              }
              return buffer.slice(2, expected)
            } finally {
              signal.removeEventListener("abort", close)
              close()
              try { reader?.releaseLock() } catch { /* A failed host lock still releases its socket. */ }
              try { writer?.releaseLock() } catch { /* A failed host lock still releases its socket. */ }
            }
          },
          catch: (cause) => cause instanceof Dns.AuthoritativeDnsError ? cause : error("resolveTxtAt", "Transport", "Authoritative DNS TCP failed; the Worker host may block this nameserver address")
        }).pipe(Effect.flatMap((body) => Effect.fromResult(wire.parse(body, name, 0))))
      })))
    return Context.make(EffectDns.Dns, service).pipe(Context.add(Dns.Dns, service))
  }))

/**
 * Cloudflare sockets are loaded only when queried. Other Worker hosts fail
 * Unsupported, explaining why recursive DoH cannot replace an authority.
 * @since 0.0.12
 */
export const layer: Layer.Layer<Dns.Dns | EffectDns.Dns, never, HttpClient.HttpClient> = layerWith({
  connect: async (address) => {
    let sockets: { connect: Options["connect"] }
    try { sockets = await import("cloudflare:sockets") }
    catch { throw error("resolveTxtAt", "Unsupported", "This Worker host has no authoritative DNS TCP transport; recursive DoH cannot replace it") }
    return sockets.connect(address)
  }
})

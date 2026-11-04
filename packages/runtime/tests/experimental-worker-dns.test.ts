import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { FetchHttpClient } from "effect/http"
import * as fc from "fast-check"
import { Dns } from "vibelang-runtime/experimental"
import { Dns as EffectDns, NetAddress } from "effect/net"
import { ExperimentalWorkerDns } from "vibelang-runtime/experimental/platform-worker"
import { answer, name, txt } from "./dns-fixture.js"

const fakeFetch = (status = 0): typeof fetch => (async (input: RequestInfo | URL) => {
  const url = new URL(String(input))
  return Response.json({ Status: status, Answer: [
    { type: 2, data: "ns.example.test" }, { type: 1, data: "192.0.2.53" }, { type: 16, data: '"cached-value"' }
  ].filter((record) => record.type === (url.searchParams.get("type") === "NS" ? 2 : 1)) })
}) as typeof fetch

const http = Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fakeFetch()))
const withHttp = (layer: Layer.Layer<Dns.Dns, never, import("effect/http/HttpClient").HttpClient>) => Layer.provide(layer, http)

const socket = (flags: number, fragment: number, onClose: () => void): ExperimentalWorkerDns.Socket => {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
  return {
    readable,
    writable: new WritableStream<Uint8Array>({
      write(frame) {
        const body = answer(frame.subarray(2), [{ type: 16, data: txt(["fresh-", "value"]) }], flags)
        const response = new Uint8Array(body.length + 2)
        new DataView(response.buffer).setUint16(0, body.length)
        response.set(body, 2)
        for (let offset = 0; offset < response.length; offset += fragment) controller.enqueue(response.slice(offset, offset + fragment))
        controller.close()
      }
    }),
    closed: Promise.resolve(),
    close: async () => { onClose() }
  }
}

test("Worker discovery uses the injected HttpClient; authoritative TXT uses only TCP with AA", async () => {
  let closed = 0
  const addresses: unknown[] = []
  const layer = withHttp(ExperimentalWorkerDns.layerWith({
    connect: (address) => { addresses.push(address); return socket(0x8400, 1, () => closed++) }
  }))
  const result = await Effect.runPromise(Effect.provide(Effect.gen(function*() {
    const dns = yield* Dns.Dns
    expect(dns).toBe(yield* EffectDns.Dns)
    return [
      (yield* dns.resolve("example.test", "NS")).map(record => record.host),
      (yield* dns.resolve("ns.example.test", "A")).map(record => NetAddress.formatIp(record.address)),
      yield* dns.resolveTxtAt("192.0.2.53", name)
    ]
  }), layer))
  expect(result).toEqual([["ns.example.test."], ["192.0.2.53"], ["fresh-value"]])
  expect(addresses).toEqual([{ hostname: "192.0.2.53", port: 53 }])
  expect(closed).toBe(1)
})

test("Worker socket framing is independent of network chunk boundaries", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 256 }), async (size) => {
    let closed = 0
    const layer = withHttp(ExperimentalWorkerDns.layerWith({ connect: () => socket(0x8400, size, () => closed++) }))
    const result = await Effect.runPromise(Effect.provide(Effect.flatMap(Dns.Dns, (dns) => dns.resolveTxtAt("192.0.2.53", name)), layer))
    expect(result).toEqual(["fresh-value"])
    expect(closed).toBe(1)
  }), { seed: 3355, numRuns: 100 })
})

test("Worker rejects recursive answers and never consults DoH as an authoritative fallback", async () => {
  let fetches = 0
  const unused = Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, (async () => {
    fetches++; return Response.json({ Status: 0, Answer: [{ type: 16, data: '"cached"' }] })
  }) as typeof fetch))
  const layer = Layer.provide(ExperimentalWorkerDns.layerWith({ connect: () => socket(0x8000, 12, () => {}) }), unused)
  const failure = await Effect.runPromise(Effect.provide(Effect.flip(Effect.flatMap(Dns.Dns, (dns) => dns.resolveTxtAt("192.0.2.53", name))), layer))
  expect(failure.reason).toBe("NotAuthoritative")
  expect(fetches).toBe(0)
})

test("Worker without cloudflare:sockets fails Unsupported, with no recursive fallback", async () => {
  const failure = await Effect.runPromise(Effect.provide(Effect.flip(Effect.flatMap(Dns.Dns, (dns) => dns.resolveTxtAt("192.0.2.53", name))), withHttp(ExperimentalWorkerDns.layer)))
  expect(failure.reason).toBe("Unsupported")
})

test("Worker timeout closes an outstanding socket; invalid server is a typed argument error", async () => {
  let closed = 0
  const layer = withHttp(ExperimentalWorkerDns.layerWith({
    timeout: 20,
    connect: () => ({
      readable: new ReadableStream<Uint8Array>({}),
      writable: new WritableStream<Uint8Array>({}),
      closed: new Promise(() => {}),
      close: async () => { closed++ }
    })
  }))
  const reasons = await Effect.runPromise(Effect.provide(Effect.gen(function*() {
    const dns = yield* Dns.Dns
    return [
      (yield* Effect.flip(dns.resolveTxtAt("192.0.2.53", name))).reason,
      (yield* Effect.flip(dns.resolveTxtAt("", name))).reason
    ]
  }), layer))
  expect(reasons).toEqual(["Timeout", "BadArgument"])
  expect(closed).toBeGreaterThan(0)
})

test("Worker discovery transport, JSON, DNS status failures stay typed", async () => {
  for (const [response, reason] of [
    [() => Response.json({ Status: 3 }), "NotFound"],
    [() => Response.json({ Status: 2 }), "ServerFailure"],
    [() => Response.json({ wrong: true }), "InvalidResponse"],
    [() => new Response("not json"), "InvalidResponse"],
    [() => new Response("", { status: 500 }), "Refused"]
  ] as const) {
    const adapter = Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, (async () => response()) as typeof fetch))
    const layer = Layer.provide(ExperimentalWorkerDns.layerWith({ connect: () => socket(0x8400, 10, () => {}) }), adapter)
    const failure = await Effect.runPromise(Effect.provide(Effect.flip(Effect.flatMap(Dns.Dns, (dns) => dns.resolve("example.test", "NS"))), layer))
    expect(failure.reason).toBe(reason)
  }
})

test("Worker closes a socket even when acquiring its stream reader fails", async () => {
  let closed = 0
  const readable = new ReadableStream<Uint8Array>()
  const held = readable.getReader()
  const layer = withHttp(ExperimentalWorkerDns.layerWith({
    connect: () => ({
      readable,
      writable: new WritableStream<Uint8Array>(),
      closed: Promise.resolve(),
      close: async () => { closed++ }
    })
  }))
  try {
    const failure = await Effect.runPromise(Effect.provide(Effect.flip(Effect.flatMap(Dns.Dns, (dns) => dns.resolveTxtAt("192.0.2.53", name))), layer))
    expect(failure.reason).toBe("Transport")
    expect(closed).toBe(1)
  } finally { held.releaseLock() }
})

test("Worker rejects malformed nameserver addresses before opening a socket", async () => {
  let connections = 0
  const layer = withHttp(ExperimentalWorkerDns.layerWith({
    connect: () => { connections++; return socket(0x8400, 1, () => {}) }
  }))
  for (const server of ["", ":", ":::", "1:2:3", "1:2:3:4:5:6:7:8:9", "999.0.0.1", "ns.example.test"]) {
    const failure = await Effect.runPromise(Effect.provide(Effect.flip(Effect.flatMap(Dns.Dns, (dns) => dns.resolveTxtAt(server, name))), layer))
    expect(failure.reason).toBe("BadArgument")
  }
  expect(connections).toBe(0)
})

test("Worker reports a short TCP frame as typed InvalidData and closes it", async () => {
  let closed = 0
  const layer = withHttp(ExperimentalWorkerDns.layerWith({
    connect: () => ({
      readable: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([0, 40, 1])); controller.close() } }),
      writable: new WritableStream<Uint8Array>(),
      closed: Promise.resolve(),
      close: async () => { closed++ }
    })
  }))
  const failure = await Effect.runPromise(Effect.provide(Effect.flip(Effect.flatMap(Dns.Dns, (dns) => dns.resolveTxtAt("192.0.2.53", name))), layer))
  expect(failure.reason).toBe("InvalidData")
  expect(closed).toBe(1)
})

import { expect, test } from "bun:test"
import { createSocket } from "node:dgram"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as fc from "fast-check"
import { Dns } from "vibelang-runtime/experimental"
import { Dns as EffectDns, NetAddress } from "effect/net"
import { ExperimentalNodeDns } from "vibelang-runtime/experimental/platform-node"
import * as wire from "../src/experimental/internal/dnsWire.js"
import { answer, dnsName, name, question, txt } from "./dns-fixture.js"

test("Node DNS discovers NS/A and asks only the supplied server, joining TXT chunks per RR", async () => {
  const socket = createSocket("udp4")
  let queries = 0
  socket.on("message", (request, remote) => {
    queries++
    const type = request.readUInt16BE(request.length - 4)
    const record = type === 2 ? { type, data: dnsName("ns.example.test") }
      : type === 1 ? { type, data: Uint8Array.from([127, 0, 0, 1]) }
      : { type: 16, data: txt(["challenge-", "value"]) }
    const records = type === 16 ? [record, { type: 16, data: txt(["other"]) }] : [record]
    socket.send(answer(request, records), remote.port, remote.address)
  })
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve))
  try {
    const address = socket.address()
    const server = `127.0.0.1:${address.port}`
    // Bun's node:dns flattens TXT chunks into separate RRs. Exercise the
    // Node layer in Node itself while this process hosts the fake UDP server.
    const { stdout } = await promisify(execFile)("node", ["--input-type=module", "-e", `
      import * as Effect from "effect/Effect"
      import { Dns } from "vibelang-runtime/experimental"
import { Dns as EffectDns, NetAddress } from "effect/net"
      import { ExperimentalNodeDns } from "vibelang-runtime/experimental/platform-node"
      const result = await Effect.runPromise(Effect.provide(Effect.gen(function*() {
        const dns = yield* Dns.Dns
        return {
          ns: (yield* dns.resolve("example.test", "NS")).map(record => record.host),
          ips: (yield* dns.resolve("ns.example.test", "A")).map(record => NetAddress.formatIp(record.address)),
          shared: dns === (yield* EffectDns.Dns),
          txt: yield* dns.resolveTxtAt(${JSON.stringify(server)}, ${JSON.stringify(name)}),
          invalid: (yield* Effect.flip(dns.resolveTxtAt("", ${JSON.stringify(name)}))).reason
        }
      }), ExperimentalNodeDns.layerWith({ nameServers: [${JSON.stringify(server)}], timeout: 200, tries: 1 })))
      console.log(JSON.stringify(result))
    `])
    const result = JSON.parse(stdout)
    expect(result).toEqual({ ns: ["ns.example.test."], shared: true, ips: ["127.0.0.1"], txt: ["challenge-value", "other"], invalid: "BadArgument" })
    expect(queries).toBe(3)
  } finally { socket.close() }
})

test("Node DNS errors and timeout remain typed", async () => {
  const socket = createSocket("udp4")
  socket.on("message", (request, remote) => {
    if (request.includes(Buffer.from("missing"))) socket.send(answer(request, [], 0x8403), remote.port, remote.address)
  })
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve))
  try {
    const server = `127.0.0.1:${socket.address().port}`
    const values = await Effect.runPromise(Effect.provide(Effect.gen(function*() {
      const dns = yield* Dns.Dns
      return [
        (yield* Effect.flip(dns.resolveTxtAt(server, "missing.test"))).reason,
        (yield* Effect.flip(dns.resolveTxtAt(server, "timeout.test"))).reason
      ]
    }), ExperimentalNodeDns.layerWith({ timeout: 100, tries: 1 })))
    expect(values).toEqual(["NotFound", "Timeout"])
  } finally { socket.close() }
}, 10000)

test("wire TXT parsing round-trips chunked records and rejects arbitrary malformed packets without throwing", () => {
  const chunk = fc.array(fc.integer({ min: 32, max: 126 }), { maxLength: 100 }).map((codes) => String.fromCharCode(...codes))
  fc.assert(fc.property(fc.array(fc.array(chunk, { minLength: 1, maxLength: 5 }), { maxLength: 6 }), (records) => {
    const packet = answer(question(), records.map((chunks) => ({ type: 16, data: txt(chunks) })))
    expect(Result.getOrThrow(wire.parse(packet, name, 0))).toEqual(records.map((chunks) => chunks.join("")))
    if (packet.length > question().length) expect(Result.isFailure(wire.parse(packet.slice(0, -1), name, 0))).toBe(true)
  }), { seed: 3353, numRuns: 1000 })
  fc.assert(fc.property(fc.uint8Array({ maxLength: 1024 }), (bytes) => {
    const result = wire.parse(bytes, name, 0)
    expect(Result.isFailure(result) || Result.isSuccess(result)).toBe(true)
  }), { seed: 3354, numRuns: 2000 })
})

test("wire parser rejects recursive answers, wrong ids/questions, TC, malformed TXT and compression loops", () => {
  const good = answer(question(), [{ type: 16, data: txt(["ok"]) }])
  const variants = [
    answer(question(), [], 0x8000), answer(question(), [], 0x8600),
    answer(question(name, 9), []), answer(question("other.test"), []),
    answer(question(), [{ type: 16, data: Uint8Array.from([5, 65]) }])
  ]
  const loop = good.slice()
  loop[question().length] = 0xc0
  loop[question().length + 1] = question().length
  variants.push(loop)
  for (const packet of variants) expect(Result.isFailure(wire.parse(packet, name, 0))).toBe(true)
})

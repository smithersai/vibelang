import assert from "node:assert/strict"
import { createSocket } from "node:dgram"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import { Base64, Base64Url } from "effect/encoding"
import { FetchHttpClient } from "effect/http"
import { Dns as EffectDns } from "effect/net"
import { Dns, Encoding } from "vibelang-runtime/experimental"
import { ExperimentalNodeDns } from "vibelang-runtime/experimental/platform-node"
import { ExperimentalWorkerDns } from "vibelang-runtime/experimental/platform-worker"
import * as vibe from "./out/main.js"

// The Effect TypeScript counterpart of main.vibe.
const txtAt = (server, name) => Effect.gen(function*() {
  const dns = yield* Dns.Dns
  return yield* dns.resolveTxtAt(server, name).pipe(Effect.catch((e) => Effect.succeed(["error:" + e.reason])))
})
const reference = {
  viaNode: (nameServer, server, name) => Effect.provide(Effect.gen(function*() {
    return { shared: (yield* Dns.Dns) === (yield* EffectDns.Dns), txt: yield* txtAt(server, name) }
  }), ExperimentalNodeDns.layerWith({ nameServers: [nameServer], timeout: 500, tries: 1 })),
  viaWorker: (connect, server, name) => Effect.provide(txtAt(server, name), Layer.provide(ExperimentalWorkerDns.layerWith({ connect, timeout: 2000 }), FetchHttpClient.layer)),
  viaWorkerHost: (server, name) => Effect.provide(txtAt(server, name), Layer.provide(ExperimentalWorkerDns.layer, FetchHttpClient.layer)),
  lenient: (input) => Encoding.decodeBase64Lenient(input),
  strict: (input) => Base64.decode(input),
  strictUrl: (input) => Base64Url.decode(input)
}

const name = "_acme-challenge.example.test"
const label = (value) => value.split(".").flatMap((part) => [part.length, ...Buffer.from(part)])
const txt = (chunks) => Buffer.concat(chunks.map((chunk) => Buffer.concat([Buffer.from([chunk.length]), Buffer.from(chunk)])))
// A DNS answer echoing the question, with the given header flags.
const answer = (request, records, flags) => {
  const parts = [Buffer.from(request)]
  for (const record of records) {
    const head = Buffer.alloc(12)
    head.writeUInt16BE(0xc00c, 0); head.writeUInt16BE(record.type, 2); head.writeUInt16BE(1, 4)
    head.writeUInt32BE(60, 6); head.writeUInt16BE(record.data.length, 10)
    parts.push(head, record.data)
  }
  const bytes = Buffer.concat(parts)
  bytes.writeUInt16BE(flags, 2)
  bytes.writeUInt16BE(records.length, 6)
  return bytes
}

const udpServer = async (records) => {
  const socket = createSocket("udp4")
  const server = { queries: 0, socket }
  socket.on("message", (request, remote) => {
    server.queries++
    socket.send(answer(request, records, 0x8400), remote.port, remote.address)
  })
  await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve))
  server.address = `127.0.0.1:${socket.address().port}`
  return server
}

const results = {}
for (const [side, program] of [["vibe", vibe], ["effect", reference]]) {
  // Node: the layer's configured resolver never sees the TXT query; only the
  // supplied authority does, and each RR's chunks are joined.
  const resolver = await udpServer([{ type: 16, data: txt(["from-resolver"]) }])
  const authority = await udpServer([{ type: 16, data: txt(["challenge-", "value"]) }, { type: 16, data: txt(["other"]) }])
  try {
    const node = await Effect.runPromise(program.viaNode(resolver.address, authority.address, name))
    results[side] = { node, resolverQueries: resolver.queries, authorityQueries: authority.queries }
  } finally {
    resolver.socket.close(); authority.socket.close()
  }

  // Worker: one TCP connection to port 53 of the supplied server, a query
  // with RD clear, and an answer accepted only when AA is set.
  const worker = []
  for (const flags of [0x8400, 0x8000]) {
    const seen = []
    const connect = (address) => {
      let controller
      const readable = new ReadableStream({ start(value) { controller = value } })
      return {
        readable,
        writable: new WritableStream({
          write(frame) {
            const request = frame.subarray(2)
            seen.push({ address, rd: (Buffer.from(request).readUInt16BE(2) & 0x0100) !== 0 })
            const body = answer(request, [{ type: 16, data: txt(["fresh-", "value"]) }], flags)
            const framed = Buffer.alloc(body.length + 2)
            framed.writeUInt16BE(body.length, 0)
            body.copy(framed, 2)
            controller.enqueue(new Uint8Array(framed))
            controller.close()
          }
        }),
        closed: Promise.resolve(),
        close: async () => {}
      }
    }
    worker.push({ txt: await Effect.runPromise(program.viaWorker(connect, "192.0.2.53", name)), seen })
  }
  results[side].worker = worker
  results[side].workerHost = await Effect.runPromise(program.viaWorkerHost("192.0.2.53", name))

  // Base64: lenient decoding matches Node's Buffer decoder; Effect's strict
  // decoders keep rejecting what only Node accepts.
  const inputs = ["aGVsbG8=", "aGVsbG8", "aGVs bG8=", "aGVs\nbG8", "-_-_", "+/+/", "aGVsbG8=trailing", "aGVsbG8x9", "%%%"]
  results[side].base64 = inputs.map((input) => {
    const lenient = program.lenient(input)
    assert.ok(Result.isResult(lenient), "decodeBase64Lenient returns a Result")
    assert.ok(Result.isSuccess(lenient))
    assert.deepEqual(Buffer.from(lenient.success), Buffer.from(input, "base64"), `lenient ${JSON.stringify(input)}`)
    const strict = program.strict(input)
    const strictUrl = program.strictUrl(input)
    return [input, Buffer.from(lenient.success).toString("hex"), Result.isSuccess(strict), Result.isSuccess(strictUrl)]
  })
}

assert.deepEqual(results.vibe, results.effect)
const r = results.vibe
console.log("node", JSON.stringify(r.node), "resolver", r.resolverQueries, "authority", r.authorityQueries)
console.log("worker AA", JSON.stringify(r.worker[0]))
console.log("worker no AA", JSON.stringify(r.worker[1]))
console.log("worker host", JSON.stringify(r.workerHost))
for (const row of r.base64) console.log("base64", JSON.stringify(row))

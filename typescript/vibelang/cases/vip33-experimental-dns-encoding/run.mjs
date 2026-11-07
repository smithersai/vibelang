// Runs the VibeLang program and its Effect TypeScript counterpart against the
// same fake DNS hosts and compares their Exits. Node hosts two UDP servers:
// the supplied authority, and the resolver the layer is configured with,
// which a TXT query must never reach. The Worker host is a fake TCP connector.
import assert from "node:assert/strict"
import { createSocket } from "node:dgram"
import { Effect } from "effect"
import * as vibe from "./out/main.js"
import * as native from "./out/native.js"
import { observed, reset } from "./out/fixture.js"
import { Encoding } from "vibelang-runtime/experimental"

const both = async (run) => {
  reset()
  const actual = await Effect.runPromiseExit(run(vibe))
  const seen = structuredClone({ ...observed, frames: observed.frames.map((frame) => Array.from(frame)) })
  reset()
  const reference = await Effect.runPromiseExit(run(native))
  assert.deepEqual(actual, reference)
  assert.equal(actual._tag, "Success", String(actual.cause))
  return { value: actual.value, seen }
}

const server = async (chunks) => {
  const socket = createSocket("udp4")
  const types = []
  socket.on("message", (request, remote) => {
    const type = request.readUInt16BE(request.length - 4)
    types.push(type)
    const data = Buffer.concat(chunks.map((chunk) => Buffer.concat([Buffer.from([chunk.length]), Buffer.from(chunk)])))
    const record = Buffer.alloc(12)
    record.writeUInt16BE(0xc00c, 0)
    record.writeUInt16BE(16, 2)
    record.writeUInt16BE(1, 4)
    record.writeUInt32BE(60, 6)
    record.writeUInt16BE(data.length, 10)
    const response = Buffer.concat([request, record, data])
    response.writeUInt16BE(0x8400, 2)
    response.writeUInt16BE(1, 6)
    socket.send(response, remote.port, remote.address)
  })
  await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve))
  return { address: `127.0.0.1:${socket.address().port}`, types, close: () => socket.close() }
}

// Experimental.Dns is Effect's Dns service with one added member, provided on both keys.
// rule-evidence: docs/design/vips/0033-platform-stdlib.md#4f9357df863bf830 | The additions include `Experimental.Dns` (Effect's `effect/net/Dns` service extended only with TXT queries sent directly to a supplied authority) and `Experimental.Encoding.decodeBase64Lenient` (pure `Result`, no service or layer).
assert.deepEqual((await both((m) => m.extension())).value, { added: ["resolveTxtAt"], missing: [], shared: true })

// Node: the TXT query reaches only the supplied authority, never the configured resolver.
// rule-evidence: docs/design/vips/0033-platform-stdlib.md#b586edf41bb119d5 | Node DNS queries only the supplied server for TXT; Worker DNS uses TCP with recursion disabled and requires AA, or fails typed `Unsupported` when the host lacks that transport.
const authority = await server(["authority-", "value"])
const configured = await server(["configured"])
try {
  assert.deepEqual((await both((m) => m.node(authority.address, configured.address))).value, ["authority-value"])
  assert.deepEqual(authority.types, [16, 16], "each program sent one TXT query to the authority")
  assert.deepEqual(configured.types, [], "the configured resolver received no query")
} finally {
  authority.close()
  configured.close()
}

// Worker: one TCP connection to port 53, RD clear, no DoH; an answer without AA is refused.
const authoritative = await both((m) => m.worker(0x8400))
assert.deepEqual(authoritative.value, ["fresh-value"])
assert.deepEqual(authoritative.seen.addresses, [{ hostname: "192.0.2.53", port: 53 }])
assert.equal(authoritative.seen.frames.length, 1)
const [frame] = authoritative.seen.frames
assert.equal((frame[0] << 8 | frame[1]) + 2, frame.length, "a DNS-over-TCP frame carries its length")
assert.equal(frame[4] & 0x01, 0, "recursion desired is clear")
assert.equal(authoritative.seen.fetches, 0, "a TXT query never uses recursive DoH")
assert.equal((await both((m) => m.worker(0x8000))).value, "NotAuthoritative")

// Worker without cloudflare:sockets: typed Unsupported, with no recursive fallback.
const unsupported = await both((m) => m.workerWithoutSockets())
assert.equal(unsupported.value, "Unsupported")
assert.equal(unsupported.seen.fetches, 0)

// Base64: Effect's strict decoders reject what Buffer accepts; the lenient decoder matches Buffer.
// rule-evidence: docs/design/vips/0033-platform-stdlib.md#aba0a6ae09d5b176 | Effect already supplies strict `Base64` and `Base64Url`; only Node-compatible leniency is added.
assert.deepEqual(Object.keys(Encoding), ["decodeBase64Lenient"])
// Each input with what Effect's strict decoders accept: [Base64, Base64Url].
const inputs = {
  "Zm9v": [true, true], "Zm9vYg==": [true, true], "-_8": [false, true],
  "Z g==": [false, false], "Z\tg==": [false, false], "-/8=": [false, false], "Zg====": [false, false],
  "Zg==ignored": [false, false], "Zm9v!YmFy": [false, false], "\u0141\u0142\u0143\u0144": [false, false], "a": [false, false]
}
for (const [input, [strict, url]] of Object.entries(inputs)) {
  const result = vibe.decode(input)
  assert.deepEqual(result, native.decode(input), input)
  assert.deepEqual(result.lenient, Array.from(Buffer.from(input, "base64")), input)
  assert.deepEqual([result.strict, result.url], [strict, url], input)
}
console.log("dns and encoding agree")

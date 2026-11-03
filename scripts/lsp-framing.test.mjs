import assert from "node:assert/strict"
import { test } from "node:test"
import { encodeFrame, FrameDecoder, FramingError } from "../typescript/vibelang/lsp-framing.mjs"

const messages = [
  { jsonrpc: "2.0", id: 1, result: null },
  { jsonrpc: "2.0", method: "note", params: { text: "café 🐈\r\n\r\nContent-Length: 3" } },
  { jsonrpc: "2.0", id: 2, result: { list: [1, 2, 3], empty: "" } },
]
const stream = Buffer.concat(messages.map(encodeFrame))

function decode(chunks, options) {
  const decoder = new FrameDecoder(options)
  const out = []
  for (const chunk of chunks) out.push(...decoder.push(chunk))
  return { out, decoder }
}

test("every split of a frame stream decodes to the same messages, even inside a character", () => {
  for (let at = 0; at <= stream.length; at++) {
    const { out, decoder } = decode([stream.subarray(0, at), stream.subarray(at)])
    assert.deepEqual(out, messages, "split at byte " + at)
    assert.equal(decoder.buffer.length, 0)
  }
})

test("a byte at a time decodes the stream", () => {
  const { out } = decode(Array.from(stream, (_, i) => stream.subarray(i, i + 1)))
  assert.deepEqual(out, messages)
})

test("headers beside Content-Length are read past, in any case and with spaces around the number", () => {
  const body = "{\"id\":1}"
  for (const header of [
    "Content-Length: 8", "content-length:8", "CONTENT-LENGTH:   8  ",
    "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: 8",
    "Content-Length: 8\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8",
  ]) assert.deepEqual(decode([Buffer.from(header + "\r\n\r\n" + body)]).out, [{ id: 1 }], header)
})

const malformed = [
  ["no length header", "Content-Type: text\r\n\r\n{}", "header"],
  ["an empty header block", "\r\n\r\n{}", "header"],
  ["two length headers", "Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}", "header"],
  ["a word for a length", "Content-Length: two\r\n\r\n{}", "header"],
  ["a negative length", "Content-Length: -2\r\n\r\n{}", "header"],
  ["a fractional length", "Content-Length: 2.0\r\n\r\n{}", "header"],
  ["trailing text after the length", "Content-Length: 2 bytes\r\n\r\n{}", "header"],
  ["a length past safe integers", "Content-Length: 9007199254740993\r\n\r\n{}", "header"],
  ["a body that is not JSON", "Content-Length: 3\r\n\r\n{x}", "JSON"],
  ["an empty body", "Content-Length: 0\r\n\r\n", "JSON"],
  ["a body cut mid-string", "Content-Length: 2\r\n\r\n\"a\"", "JSON"],
  ["a number for a message", "Content-Length: 1\r\n\r\n7", "message"],
  ["null for a message", "Content-Length: 4\r\n\r\nnull", "message"],
  ["an array for a message", "Content-Length: 2\r\n\r\n[]", "message"],
]

for (const [name, text, stage] of malformed) {
  test("refuses " + name + ", in every chunking, after the messages before it", () => {
    const bad = Buffer.from(text)
    const whole = Buffer.concat([encodeFrame(messages[0]), bad])
    for (let at = 0; at <= whole.length; at++) {
      const decoder = new FrameDecoder()
      const out = []
      assert.throws(() => {
        for (const chunk of [whole.subarray(0, at), whole.subarray(at)]) {
          for (const message of decoder.push(chunk)) out.push(message)
        }
      }, (error) => error instanceof FramingError && error.stage === stage, name + " split at " + at)
      assert.deepEqual(out, messages.slice(0, 1), name + " split at " + at)
    }
  })
}

test("a refusal quotes nothing from the stream", () => {
  const secret = Buffer.from("Content-Length: 7\r\n\r\nsecret!")
  assert.throws(() => decode([secret]), (error) => !error.message.includes("secret"))
  assert.throws(() => decode([Buffer.from("secret: 1\r\n\r\n")]), (error) => !error.message.includes("secret"))
})

test("maxBytes bounds a frame and a header that never ends, and admits a frame at the limit", () => {
  const frame = encodeFrame({ id: 1 })
  const size = frame.length - frame.indexOf("\r\n\r\n") - 4
  assert.deepEqual(decode([frame], { maxBytes: size }).out, [{ id: 1 }])
  assert.throws(() => decode([frame], { maxBytes: size - 1 }), (e) => e instanceof FramingError && e.stage === "header")
  assert.throws(() => decode([Buffer.alloc(9, "x")], { maxBytes: 8 }), (e) => e instanceof FramingError && e.stage === "header")
  assert.deepEqual(decode([Buffer.alloc(8, "x")], { maxBytes: 8 }).out, [])
})

test("a stream that ends between frames or inside one has no message to give and no error", () => {
  const frame = encodeFrame(messages[0])
  for (let at = 0; at < frame.length; at++) assert.deepEqual(decode([frame.subarray(0, at)]).out, [])
})

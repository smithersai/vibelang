// The base protocol of the language server, as the JavaScript clients and fixtures speak it: a Content-Length header
// block, a blank line, then that many bytes of JSON. Each client keeps its own lifecycle and diagnostics; this module
// owns the bytes. https://microsoft.github.io/language-server-protocol/specifications/base/0.9/specification/

const separator = Buffer.from("\r\n\r\n")

/** stage "header", "JSON" or "message". The text never quotes the stream: a response can hold user source. */
export class FramingError extends Error {
  constructor(stage) {
    super("server sent malformed LSP " + stage)
    this.name = "FramingError"
    this.stage = stage
  }
}

export function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message))
  return Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body])
}

function bodyLength(header, maxBytes) {
  const lengths = header.split("\r\n").filter((line) => /^Content-Length:/i.test(line))
  const match = lengths.length === 1 ? /^Content-Length: *(\d+) *$/i.exec(lengths[0]) : null
  const length = match ? Number(match[1]) : NaN
  if (!Number.isSafeInteger(length) || length > maxBytes) throw new FramingError("header")
  return length
}

/** push(chunk) yields each complete message in order; a chunk may end anywhere, even inside a UTF-8 character. */
export class FrameDecoder {
  constructor({ maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
    this.maxBytes = maxBytes
    this.buffer = Buffer.alloc(0)
  }

  *push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const end = this.buffer.indexOf(separator)
      if (end < 0) {
        if (this.buffer.length > this.maxBytes) throw new FramingError("header")
        return
      }
      const length = bodyLength(this.buffer.subarray(0, end).toString(), this.maxBytes)
      const start = end + separator.length
      if (this.buffer.length < start + length) return
      const body = this.buffer.subarray(start, start + length).toString()
      this.buffer = this.buffer.subarray(start + length)
      let message
      try { message = JSON.parse(body) }
      catch { throw new FramingError("JSON") }
      if (message === null || typeof message !== "object" || Array.isArray(message)) throw new FramingError("message")
      yield message
    }
  }
}

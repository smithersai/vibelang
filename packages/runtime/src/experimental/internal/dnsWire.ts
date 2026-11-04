/** DNS-over-TCP TXT codec. Bounds, compression loops, identity and AA are checked. */
import * as Result from "effect/Result"
import { AuthoritativeDnsError as DnsError } from "../Dns.js"

const failure = (reason: DnsError["reason"], message: string) => new DnsError({ reason, operation: "resolveTxtAt", message })
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const query = (name: string, id: number): Result.Result<Uint8Array, DnsError> => {
  const labels = name.replace(/\.$/, "").split(".")
  if (labels.some((label) => !/^[\x21-\x2d\x2f-\x7e]{1,63}$/.test(label)) || labels.join(".").length > 253) {
    return Result.fail(failure("BadArgument", "DNS name must have ASCII labels of 1–63 bytes, at most 253 bytes"))
  }
  const body = new Uint8Array(12 + labels.reduce((n, label) => n + label.length + 1, 1) + 4)
  const view = new DataView(body.buffer)
  view.setUint16(0, id)
  view.setUint16(4, 1) // RD=0; one question
  let offset = 12
  for (const label of labels) {
    body[offset++] = label.length
    body.set(encoder.encode(label), offset)
    offset += label.length
  }
  offset++
  view.setUint16(offset, 16)
  view.setUint16(offset + 2, 1)
  return Result.succeed(body)
}

export const parse = (body: Uint8Array, name: string, id: number): Result.Result<ReadonlyArray<string>, DnsError> => {
  try {
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
    const need = (offset: number, size: number) => {
      if (offset < 0 || offset + size > body.length) throw failure("InvalidData", "Truncated DNS response")
    }
    const u16 = (offset: number) => { need(offset, 2); return view.getUint16(offset) }
    const readName = (start: number): { name: string; end: number } => {
      const seen = new Set<number>()
      const labels: string[] = []
      let offset = start
      let end: number | undefined
      let length = 0
      while (true) {
        need(offset, 1)
        if (seen.has(offset)) throw failure("InvalidData", "DNS compression loop")
        seen.add(offset)
        const size = body[offset++]!
        if (size === 0) return { name: labels.join(".").toLowerCase(), end: end ?? offset }
        if ((size & 192) === 192) {
          need(offset, 1)
          const pointer = ((size & 63) << 8) | body[offset]!
          if (pointer >= offset - 1) throw failure("InvalidData", "Invalid DNS compression pointer")
          end ??= offset + 1
          offset = pointer
        } else {
          if (size > 63) throw failure("InvalidData", "Invalid DNS label")
          need(offset, size)
          length += size + 1
          if (length > 254) throw failure("InvalidData", "DNS name too long")
          labels.push(decoder.decode(body.subarray(offset, offset + size)))
          offset += size
        }
      }
    }
    need(0, 12)
    const flags = u16(2)
    if (u16(0) !== id || (flags & 0x8000) === 0 || (flags & 0x7800) !== 0 || u16(4) !== 1) {
      throw failure("InvalidData", "Unexpected DNS response identity")
    }
    if ((flags & 0x0200) !== 0) throw failure("InvalidData", "Truncated DNS answer")
    if ((flags & 0x0400) === 0) throw failure("NotAuthoritative", "DNS server did not give an authoritative answer")
    if ((flags & 15) === 3) throw failure("NotFound", "DNS name not found")
    if ((flags & 15) !== 0) throw failure("Transport", "DNS server refused the query")
    const expected = name.replace(/\.$/, "").toLowerCase()
    const question = readName(12)
    if (question.name !== expected || u16(question.end) !== 16 || u16(question.end + 2) !== 1) {
      throw failure("InvalidData", "Unexpected DNS question")
    }
    let offset = question.end + 4
    const values: string[] = []
    for (let i = 0; i < u16(6); i++) {
      const owner = readName(offset)
      offset = owner.end
      need(offset, 10)
      const type = u16(offset)
      const klass = u16(offset + 2)
      const size = u16(offset + 8)
      offset += 10
      const end = offset + size
      need(offset, size)
      if (type === 16 && klass === 1 && owner.name === expected) {
        let value = ""
        while (offset < end) {
          const length = body[offset++]!
          if (offset + length > end) throw failure("InvalidData", "Truncated TXT character-string")
          value += decoder.decode(body.subarray(offset, offset + length))
          offset += length
        }
        values.push(value)
      }
      offset = end
    }
    return Result.succeed(values)
  } catch (cause) {
    return Result.fail(cause instanceof DnsError ? cause : failure("InvalidData", "Invalid DNS response"))
  }
}

import * as Result from "effect/Result"
import * as wire from "../src/experimental/internal/dnsWire.js"

export const name = "_acme-challenge.example.test"
export const question = (fqdn = name, id = 0) => Result.getOrThrow(wire.query(fqdn, id))
export const answer = (request: Uint8Array, records: Array<{ type: number; data: Uint8Array }>, flags = 0x8400) => {
  const size = records.reduce((sum, record) => sum + 12 + record.data.length, request.length)
  const bytes = new Uint8Array(size)
  bytes.set(request)
  const view = new DataView(bytes.buffer)
  view.setUint16(2, flags)
  view.setUint16(6, records.length)
  let offset = request.length
  for (const record of records) {
    bytes.set([0xc0, 0x0c], offset)
    view.setUint16(offset + 2, record.type)
    view.setUint16(offset + 4, 1)
    view.setUint32(offset + 6, 60)
    view.setUint16(offset + 10, record.data.length)
    bytes.set(record.data, offset + 12)
    offset += 12 + record.data.length
  }
  return bytes
}
export const txt = (chunks: string[]) => {
  const parts = chunks.map((chunk) => new TextEncoder().encode(chunk))
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length + 1, 0))
  let offset = 0
  for (const part of parts) { bytes[offset++] = part.length; bytes.set(part, offset); offset += part.length }
  return bytes
}
export const dnsName = (value: string) => {
  const parts = value.split(".")
  return Uint8Array.from([...parts.flatMap((part) => [part.length, ...new TextEncoder().encode(part)]), 0])
}

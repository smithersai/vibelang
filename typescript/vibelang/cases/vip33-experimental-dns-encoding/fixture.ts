import * as Layer from "effect/Layer"
import { FetchHttpClient } from "effect/http"
import type { ExperimentalWorkerDns } from "vibelang-runtime/experimental/platform-worker"

/** What the fake Worker host saw: TCP connections, their DNS query frames and discovery requests. */
export const observed = {
  addresses: [] as Array<{ readonly hostname: string; readonly port: number }>,
  frames: [] as Uint8Array[],
  fetches: 0
}

export function reset(): void {
  observed.addresses.length = 0
  observed.frames.length = 0
  observed.fetches = 0
}

/** Effect's discovery HttpClient over a fetch that counts its calls; a TXT query must not use it. */
export const discovery = Layer.provide(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, (async () => {
  observed.fetches++
  return Response.json({ Status: 0, Answer: [] })
}) as typeof fetch))

/** One DNS-over-TCP answer to the query frame: the given header flags and one TXT record of two chunks. */
function answer(frame: Uint8Array, flags: number): Uint8Array {
  const query = frame.subarray(2)
  const chunks = ["fresh-", "value"].map((chunk) => new TextEncoder().encode(chunk))
  const data = chunks.reduce((size, chunk) => size + chunk.length + 1, 0)
  const body = new Uint8Array(query.length + 12 + data)
  body.set(query)
  const view = new DataView(body.buffer)
  view.setUint16(2, flags)
  view.setUint16(6, 1)
  let offset = query.length
  body.set([0xc0, 0x0c], offset)
  view.setUint16(offset + 2, 16)
  view.setUint16(offset + 4, 1)
  view.setUint32(offset + 6, 60)
  view.setUint16(offset + 10, data)
  offset += 12
  for (const chunk of chunks) {
    body[offset++] = chunk.length
    body.set(chunk, offset)
    offset += chunk.length
  }
  const response = new Uint8Array(body.length + 2)
  new DataView(response.buffer).setUint16(0, body.length)
  response.set(body, 2)
  return response
}

/**
 * A Cloudflare-shaped TCP connector whose server answers with the given header flags.
 * @throws {never}
 */
export const connect = (flags: number): ExperimentalWorkerDns.Options["connect"] => (address) => {
  observed.addresses.push(address)
  let controller!: ReadableStreamDefaultController<Uint8Array>
  return {
    readable: new ReadableStream<Uint8Array>({ start(value) { controller = value } }),
    writable: new WritableStream<Uint8Array>({
      write(frame) {
        observed.frames.push(frame.slice())
        controller.enqueue(answer(frame, flags))
        controller.close()
      }
    }),
    closed: Promise.resolve(),
    close: async () => {}
  }
}

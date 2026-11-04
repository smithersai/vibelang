import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import { Readable } from "node:stream"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import ts from "typescript"
import fc from "fast-check"

const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-node-response-close.json", import.meta.url), "utf8"))
expect(createHash("sha256").update(corpus.original).digest("hex")).toBe(corpus.source.sha256)
const originalJs = ts.transpileModule(corpus.original, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const load = () => import("../src/experimental/NodeStream.js")
type Model = { readonly chunks: ReadonlyArray<ReadonlyArray<number>>; readonly readReject: boolean; readonly cancelReject: boolean; readonly aborted: boolean; readonly closeFirst: boolean; readonly repeatClose: boolean; readonly toggleAbort: boolean; readonly consume: boolean }
const defaultModel: Model = { chunks: [[1, 2]], readReject: false, cancelReject: false, aborted: false, closeFirst: false, repeatClose: false, toggleAbort: false, consume: false }
function frame(model: Model) {
  const failure = new Error("native-body"), response = new EventEmitter(), signal = { aborted: model.aborted }
  const trace = { readers: 0, reads: 0, readerCancels: [] as Array<string>, physicalCancels: 0, destroys: 0, errors: [] as Array<string>, unrelatedCloses: 0 }
  response.on("close", () => trace.unrelatedCloses++)
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (model.readReject) { controller.error(failure); return }
      if (index === model.chunks.length) { controller.close(); return }
      controller.enqueue(new Uint8Array(model.chunks[index++]!))
    },
    cancel() { trace.physicalCancels++; if (model.cancelReject) return Promise.reject(failure) }
  }, { highWaterMark: 0 })
  const getReader = body.getReader.bind(body)
  body.getReader = (() => {
    trace.readers++
    const reader = getReader()
    const read = reader.read.bind(reader), cancel = reader.cancel.bind(reader)
    reader.read = () => { trace.reads++; return read() }
    reader.cancel = (reason) => {
      trace.readerCancels.push(reason === failure ? "native" : reason instanceof Error ? reason.name + ":" + reason.message : String(reason))
      return cancel(reason)
    }
    return reader
  }) as typeof body.getReader
  let native!: Readable, closed!: Promise<void>
  const host = {
    makeReadableStream: (source: UnderlyingDefaultSource<Uint8Array>) => new ReadableStream<Uint8Array>(source),
    fromWeb(stream: ReadableStream<Uint8Array>) {
      native = Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0])
      closed = new Promise(resolve => native.once("close", () => resolve()))
      native.on("error", error => trace.errors.push(error === failure ? "native" : error.name))
      const destroy = native.destroy
      native.destroy = function(error) { trace.destroys++; return destroy.call(this, error) }
      return native
    }
  }
  return { host, body, response, signal, trace, failure, get native() { return native }, get closed() { return closed } }
}
function original(f: ReturnType<typeof frame>) {
  const exports: { originalBridge?: (response: { body: ReadableStream<Uint8Array> }, owner: EventEmitter, signal: { aborted: boolean }) => Readable } = {}
  new Function("Readable", "ReadableStream", "exports", originalJs)({ fromWeb: f.host.fromWeb }, ReadableStream, exports)
  return exports.originalBridge!({ body: f.body }, f.response, f.signal)
}
async function observe(model: Model, factory: (f: ReturnType<typeof frame>) => Effect.Effect<unknown>) {
  const f = frame(model)
  await Effect.runPromise(factory(f))
  const initial = { locked: f.body.locked, readers: f.trace.readers, responseListeners: f.response.listenerCount("close"), destroyed: f.native.destroyed }
  if (model.toggleAbort) f.signal.aborted = !f.signal.aborted
  const destroyedAfterToggle = f.native.destroyed
  if (model.closeFirst) f.response.emit("close")
  if (model.repeatClose) { f.response.emit("close"); f.response.emit("close") }
  const bytes: Array<number> = [], iteratorErrors: Array<string> = []
  try {
    if (model.consume) {
      try { for await (const chunk of f.native) bytes.push(...chunk) }
      catch (error) { iteratorErrors.push(error === f.failure ? "native" : (error as Error).name) }
    }
  } finally {
    if (!f.native.destroyed) f.native.destroy()
    await f.closed
  }
  const finalListeners = f.response.listenerCount("close")
  f.response.emit("close")
  return { initial, destroyedAfterToggle, bytes, iteratorErrors, ...f.trace, finalListeners }
}
describe("Experimental eager Web body bridge", () => {
  it("is cold and eagerly owns the reader when executed", async () => {
    const api = await load(), f = frame(defaultModel)
    const effect = api.make(f.host).fromWeb(f.body, { response: f.response, signal: f.signal })
    expect(f.trace.readers).toBe(0)
    await Effect.runPromise(effect)
    expect(f.trace.readers).toBe(1)
    expect(f.body.locked).toBe(true)
    expect(f.response.listenerCount("close")).toBe(2)
    f.response.emit("close"); await f.closed
    expect(f.trace.physicalCancels).toBe(1)
    expect(f.response.listenerCount("close")).toBe(1)
  })
  it("cancels an unpulled HEAD body and removes only its own listener", async () => {
    const api = await load()
    const result = await observe({ ...defaultModel, closeFirst: true, repeatClose: true }, f => api.make(f.host).fromWeb(f.body, { response: f.response, signal: f.signal }))
    expect(result.readerCancels).toHaveLength(1)
    expect(result.physicalCancels).toBe(1)
    expect(result.finalListeners).toBe(1)
  })
  it("preserves the one-time aborted check without adding a live abort listener", async () => {
    const api = await load()
    const create = (f: ReturnType<typeof frame>) => api.make(f.host).fromWeb(f.body, { response: f.response, signal: f.signal })
    expect((await observe({ ...defaultModel, aborted: true }, create)).initial.destroyed).toBe(true)
    expect((await observe({ ...defaultModel, toggleAbort: true }, create)).destroyedAfterToggle).toBe(false)
  })
  it("forwards bytes and preserves read-error identity through the native readable", async () => {
    const api = await load()
    const create = (f: ReturnType<typeof frame>) => api.make(f.host).fromWeb(f.body, { response: f.response, signal: f.signal })
    expect((await observe({ ...defaultModel, chunks: [[1, 2], [3]], consume: true }, create)).bytes).toEqual([1, 2, 3])
    expect((await observe({ ...defaultModel, readReject: true, consume: true }, create)).errors).toContain("native")
  })
  it("allows a fake body without reading the host", async () => {
    const api = await load(), f = frame(defaultModel), sentinel = { destroy: () => undefined, once: (_event: "close", _listener: () => void) => undefined }
    const program = Effect.flatMap(api.NodeStream, streams => streams.fromWeb(f.body, { response: f.response, signal: f.signal }))
    expect(await Effect.runPromise(Effect.provide(program, api.layerTest({ fromWeb: () => Effect.succeed(sentinel) })))).toBe(sentinel)
    expect(f.trace.readers).toBe(0)
    await f.body.cancel()
  })
  it("matches the frozen Foldkit bridge across 500 native ownership/cancellation schedules", async () => {
    const api = await load()
    const arbitrary = fc.record({
      chunks: fc.array(fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 6 }), { maxLength: 3 }),
      readReject: fc.boolean(), cancelReject: fc.boolean(), aborted: fc.boolean(),
      closeFirst: fc.boolean(), repeatClose: fc.boolean(), toggleAbort: fc.boolean(), consume: fc.boolean()
    })
    await fc.assert(fc.asyncProperty(arbitrary, async model => {
      const before = await observe(model, f => Effect.sync(() => original(f)))
      const after = await observe(model, f => api.make(f.host).fromWeb(f.body, { response: f.response, signal: f.signal }))
      expect(after).toEqual(before)
    }), { seed: 531165, numRuns: 500, examples: corpus.models.map((model: Model) => [model]) })
  })
})

it("preserves the original HEAD/close/aborted behavior through real Node and Bun HTTP adapters", async () => {
  await load()
  const { spawnSync } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  const fixture = fileURLToPath(new URL("./fixtures/eager-web-body-host.mjs", import.meta.url))
  for (const executable of ["node", "bun"]) {
    const child = spawnSync(executable, [fixture], { encoding: "utf8", timeout: 30000 })
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(0)
    const line = child.stdout.split("\n").find(line => line.startsWith("EAGER-WEB-BODY "))
    expect(line).toBeDefined()
    expect(JSON.parse(line!.slice("EAGER-WEB-BODY ".length))).toEqual({ host: executable, originalHeadEquivalent: true, cancels: 1, listenerRemoved: true, responseClose: true, alreadyAborted: true })
  }
}, 65000)

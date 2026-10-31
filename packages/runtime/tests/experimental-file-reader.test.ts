import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as PlatformError from "effect/PlatformError"
import * as fc from "fast-check"
import { FileReader } from "vibelang-runtime/experimental"
import { ExperimentalBrowserFileReader } from "vibelang-runtime/experimental/platform-browser"

type Outcome =
  | { readonly load: string | ArrayBuffer | null }
  | { readonly error: { readonly name: string; readonly message: string } }
  | { readonly throws: unknown }
  | "pending"

// A FileReader that settles asynchronously, as a host's does, with what the test says.
const fakeHost = (outcome: Outcome) => {
  const calls: Array<string> = []
  const host: FileReader.Host = {
    makeReader: () => {
      const listeners: Record<string, () => void> = {}
      const reader = {
        result: null as string | ArrayBuffer | null,
        error: null as { readonly name: string; readonly message: string } | null,
        addEventListener: (type: "load" | "error", listener: () => void) => {
          listeners[type] = listener
        },
        abort: () => calls.push("abort"),
        readAsText: (_: Blob) => start("readAsText"),
        readAsDataURL: (_: Blob) => start("readAsDataURL"),
        readAsArrayBuffer: (_: Blob) => start("readAsArrayBuffer")
      }
      const start = (method: string) => {
        calls.push(method)
        if (outcome === "pending") return
        if ("throws" in outcome) throw outcome.throws
        queueMicrotask(() => {
          if ("load" in outcome) {
            reader.result = outcome.load
            listeners.load!()
          } else {
            reader.error = outcome.error
            listeners.error!()
          }
        })
      }
      return reader
    }
  }
  return { calls, host }
}

const blob = new Blob(["hi"], { type: "text/plain" })

const failureOf = <A>(effect: Effect.Effect<A, PlatformError.PlatformError>) =>
  Effect.runPromise(Effect.map(Effect.flip(effect), (error) => {
    expect(PlatformError.isPlatformError(error)).toBe(true)
    return { _tag: error.reason._tag, module: error.reason.module, method: error.reason.method, description: error.reason.description }
  }))

test("FileReader: each member calls its host method and gives the result", async () => {
  const buffer = new Uint8Array([1, 2]).buffer
  const text = fakeHost({ load: "hi" })
  expect(await Effect.runPromise(FileReader.make(text.host).readAsText(blob))).toBe("hi")
  const url = fakeHost({ load: "data:text/plain;base64,aGk=" })
  expect(await Effect.runPromise(FileReader.make(url.host).readAsDataUrl(blob))).toBe("data:text/plain;base64,aGk=")
  const bytes = fakeHost({ load: buffer })
  expect(await Effect.runPromise(FileReader.make(bytes.host).readAsArrayBuffer(blob))).toBe(buffer)
  expect([...text.calls, ...url.calls, ...bytes.calls]).toEqual(["readAsText", "readAsDataURL", "readAsArrayBuffer"])
})

test("FileReader: a host error fails with a PlatformError that keeps the host's message", async () => {
  const cases = [["NotFoundError", "NotFound"], ["SecurityError", "PermissionDenied"], ["NotReadableError", "BadResource"], ["AbortError", "Unknown"]] as const
  for (const [name, _tag] of cases) {
    const service = FileReader.make(fakeHost({ error: { name, message: "the file went away" } }).host)
    expect(await failureOf(service.readAsText(blob))).toEqual({ _tag, module: "FileReader", method: "readAsText", description: "the file went away" })
  }
})

test("FileReader: a read that throws and a result of the wrong kind fail, not die", async () => {
  const thrown = FileReader.make(fakeHost({ throws: new TypeError("not a Blob") }).host)
  expect(await failureOf(thrown.readAsDataUrl(blob))).toMatchObject({ _tag: "BadArgument", method: "readAsDataURL", description: "not a Blob" })
  const wrong = FileReader.make(fakeHost({ load: new ArrayBuffer(1) }).host)
  expect(await failureOf(wrong.readAsText(blob))).toMatchObject({ _tag: "Unknown", method: "readAsText" })
  const empty = FileReader.make(fakeHost({ load: "text" }).host)
  expect(await failureOf(empty.readAsArrayBuffer(blob))).toMatchObject({ _tag: "Unknown", method: "readAsArrayBuffer" })
})

test("FileReader: a call that throws is BadArgument and an error event is a SystemError, each with the host's own cause (property)", async () => {
  const causes = fc.oneof(
    fc.record({ name: fc.string({ maxLength: 16 }), message: fc.string({ maxLength: 16 }) }),
    fc.record({ name: fc.constantFrom("NotFoundError", "SecurityError", "NotReadableError", "AbortError"), message: fc.string({ maxLength: 16 }) })
  )
  const methods = fc.constantFrom("readAsText", "readAsDataUrl", "readAsArrayBuffer") as fc.Arbitrary<"readAsText" | "readAsDataUrl" | "readAsArrayBuffer">
  await fc.assert(fc.asyncProperty(causes, fc.anything(), methods, async (cause, thrownValue, method) => {
    const reason = (outcome: Outcome) =>
      Effect.runPromise(Effect.map(Effect.flip(FileReader.make(fakeHost(outcome).host)[method](blob)), (error) => error.reason))
    const fromEvent = await reason({ error: cause })
    const fromThrow = await reason({ throws: cause })
    const fromAnyThrow = await reason({ throws: thrownValue })
    expect(fromEvent._tag).not.toBe("BadArgument")
    expect(fromThrow._tag).toBe("BadArgument")
    expect(fromAnyThrow._tag).toBe("BadArgument")
    expect(fromEvent.cause).toBe(cause)
    expect(fromThrow.cause).toBe(cause)
    expect(fromAnyThrow.cause).toBe(thrownValue)
  }), { seed: 24, numRuns: 200 })
})

test("FileReader: interrupting a read aborts it", async () => {
  const { calls, host } = fakeHost("pending")
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(FileReader.make(host).readAsText(blob))
    yield* Effect.yieldNow
    while (calls.length === 0) yield* Effect.yieldNow
    yield* Fiber.interrupt(fiber)
  }))
  expect(calls).toEqual(["readAsText", "abort"])
})

test("FileReader: the browser layer reads the host when a member runs", async () => {
  const host = globalThis as { FileReader?: unknown }
  const original = host.FileReader
  delete host.FileReader
  const read = Effect.flatMap(Effect.service(FileReader.FileReader), (reader) => reader.readAsText(blob))
  try {
    const missing = await Effect.runPromiseExit(Effect.provide(read, ExperimentalBrowserFileReader.layer))
    expect(Exit.isFailure(missing)).toBe(true)
    expect(String(missing)).toContain("window.FileReader")
    host.FileReader = class {
      result = "from the host"
      error = null
      listeners: Record<string, () => void> = {}
      addEventListener(type: string, listener: () => void) {
        this.listeners[type] = listener
      }
      abort() {}
      readAsText() {
        queueMicrotask(() => this.listeners.load!())
      }
    }
    expect(await Effect.runPromise(Effect.provide(read, ExperimentalBrowserFileReader.layer))).toBe("from the host")
  } finally {
    if (original === undefined) delete host.FileReader
    else host.FileReader = original
  }
})

test("FileReader: layerTest reads the Blob itself, and agrees with the bytes for any contents", async () => {
  await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 64 }), fc.string({ maxLength: 32 }), async (bytes, text) => {
    const reads = Effect.flatMap(Effect.service(FileReader.FileReader), (reader) =>
      Effect.all([
        reader.readAsArrayBuffer(new Blob([new Uint8Array(bytes)])),
        reader.readAsDataUrl(new Blob([new Uint8Array(bytes)], { type: "application/x-test" })),
        reader.readAsText(new Blob([text]))
      ]))
    const [buffer, url, read] = await Effect.runPromise(Effect.provide(reads, FileReader.layerTest()))
    expect([...new Uint8Array(buffer)]).toEqual([...bytes])
    expect(url).toBe(`data:application/x-test;base64,${btoa(String.fromCharCode(...bytes))}`)
    expect(read).toBe(new TextDecoder().decode(new TextEncoder().encode(text)))
  }), { numRuns: 100 })
})

test("FileReader: layerTest takes the members a test needs", async () => {
  const failing = FileReader.layerTest({
    readAsText: () => Effect.fail(PlatformError.badArgument({ module: "FileReader", method: "readAsText", description: "no" }))
  })
  const read = Effect.flatMap(Effect.service(FileReader.FileReader), (reader) => reader.readAsText(blob))
  expect(await failureOf(Effect.provide(read, failing))).toMatchObject({ _tag: "BadArgument" })
})

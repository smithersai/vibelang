import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { Document } from "vibelang-runtime/experimental"
import { ExperimentalBrowserDocument } from "vibelang-runtime/experimental/platform-browser"

test("Document: current gives the host's document, read when it runs", async () => {
  const first = new EventTarget() as unknown as globalThis.Document
  const second = new EventTarget() as unknown as globalThis.Document
  let current = first
  const service = Document.make({ document: () => current })
  expect(await Effect.runPromise(service.current)).toBe(first)
  current = second
  expect(await Effect.runPromise(service.current)).toBe(second)
})

test("Document: a listener on current runs in the dispatch stack, so it can cancel the event", async () => {
  const target = new EventTarget() as unknown as globalThis.Document
  const program = Effect.flatMap(Effect.service(Document.Document), (document) =>
    Effect.flatMap(document.current, (current) => Effect.sync(() => {
      let prevented = false
      current.addEventListener("keydown", (event) => {
        event.preventDefault()
        prevented = event.defaultPrevented
      })
      current.dispatchEvent(new Event("keydown", { cancelable: true }))
      return prevented
    })))
  expect(await Effect.runPromise(Effect.provide(program, Document.layerTest(target)))).toBe(true)
})

test("Document: Stream.fromEventListener reads current as its target", async () => {
  const target = new EventTarget() as unknown as globalThis.Document
  const program = Effect.flatMap(Effect.service(Document.Document), (document) =>
    Effect.flatMap(document.current, (current) => Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Stream.runHead(Stream.fromEventListener<Event>(current, "keydown")))
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
      current.dispatchEvent(new Event("keydown"))
      return yield* Fiber.join(fiber)
    })))
  expect((await Effect.runPromise(Effect.provide(program, Document.layerTest(target))))._tag).toBe("Some")
})

test("Document: the browser layer reads the host when a member runs", async () => {
  const host = globalThis as { document?: unknown }
  const original = host.document
  delete host.document
  const current = Effect.flatMap(Effect.service(Document.Document), (document) => document.current)
  try {
    await Effect.runPromise(Effect.provide(Effect.service(Document.Document), ExperimentalBrowserDocument.layer))
    const missing = await Effect.runPromiseExit(Effect.provide(current, ExperimentalBrowserDocument.layer))
    expect(Exit.isFailure(missing)).toBe(true)
    expect(String(missing)).toContain("window.document")
    const fake = new EventTarget()
    host.document = fake
    expect(await Effect.runPromise(Effect.provide(current, ExperimentalBrowserDocument.layer))).toBe(fake as never)
  } finally {
    if (original === undefined) delete host.document
    else host.document = original
  }
})

// VIP-9 document capability preserves native Document identity and event-map type; rule: docs/design/vips/0009-service-declarations.md#99e9cd6fc1fb1b10

// VIP-9 document capability preserves native Document identity and event-map type; rule: docs/design/vips/0009-service-declarations.md#57ce4b3d2fa39f54

// VIP-9 document capability preserves native Document identity and event-map type; rule: docs/design/vips/0009-service-declarations.md#529263766efb8f44

// VIP-9 document capability preserves native Document identity and event-map type; rule: docs/design/vips/0009-service-declarations.md#6d621961f08378b0

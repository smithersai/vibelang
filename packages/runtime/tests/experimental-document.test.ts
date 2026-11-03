import { expect, test } from "bun:test"
import * as fc from "fast-check"
import * as Cause from "effect/Cause"
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
  const service = Document.make({ document: () => current, isHTMLElement: (_): _ is HTMLElement => false, escapeSelector: (value) => value })
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

const absent = Symbol("absent")
const withHostElement = <A>(value: unknown, f: () => A): A => {
  const host = globalThis as { HTMLElement?: unknown }
  const had = "HTMLElement" in host
  const original = host.HTMLElement
  if (value === absent) delete host.HTMLElement
  else host.HTMLElement = value
  try {
    return f()
  } finally {
    if (had) host.HTMLElement = original
    else delete host.HTMLElement
  }
}
const browserDocument = () =>
  Effect.runSync(Effect.provide(Effect.service(Document.Document), ExperimentalBrowserDocument.layer))
const outcome = (f: () => boolean): string => {
  try {
    return String(f())
  } catch {
    return "throws"
  }
}

test("Document: isHTMLElement follows the host's constructor, as instanceof does", () => {
  class FakeElement {}
  const document = browserDocument()
  withHostElement(FakeElement, () => {
    expect(document.isHTMLElement(new FakeElement())).toBe(true)
    expect(document.isHTMLElement({})).toBe(false)
    expect(document.isHTMLElement(null)).toBe(false)
  })
})

test("Document: isHTMLElement on a host without HTMLElement throws, as instanceof does, so the caller sees a defect", () => {
  const document = browserDocument()
  withHostElement(absent, () => {
    expect(() => document.isHTMLElement({})).toThrow("The Document service needs HTMLElement")
    const exit = Effect.runSyncExit(Effect.sync(() => document.isHTMLElement({})))
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  })
  for (const malformed of [null, 0, "HTMLElement", {}]) {
    withHostElement(malformed, () => expect(() => document.isHTMLElement({})).toThrow(TypeError))
  }
})

test("Document: isHTMLElement gives what value instanceof HTMLElement gives, or throws when it throws (property)", async () => {
  const corpus = await Bun.file(new URL("./corpus/foldkit-playground-html-element-predicate.json", import.meta.url)).json()
  class FakeElement {}
  const constructors = fc.oneof(
    fc.constant<unknown>(FakeElement),
    fc.constant<unknown>(Object),
    fc.constant<unknown>({ [Symbol.hasInstance]: (value: unknown) => value === 1 }),
    fc.anything()
  )
  const values = fc.oneof(fc.constant<unknown>(new FakeElement()), fc.constant<unknown>(1), fc.anything())
  const document = browserDocument()
  const corpusConstructors: Record<string, unknown> = {
    fake: FakeElement, object: Object, "has-instance-one": { [Symbol.hasInstance]: (value: unknown) => value === 1 },
    missing: absent, null: null
  }
  const corpusValues: Record<string, unknown> = { fake: new FakeElement(), object: {}, one: 1, zero: 0, null: null }
  for (const sample of corpus.cases) {
    const ctor = corpusConstructors[sample.constructor]
    const value = corpusValues[sample.value]
    expect(withHostElement(ctor, () => outcome(() => document.isHTMLElement(value)))).toBe(sample.outcome)
  }
  fc.assert(fc.property(constructors, values, (ctor, value) => {
    const expected = withHostElement(ctor, () => outcome(() => value instanceof (ctor as typeof HTMLElement)))
    expect(withHostElement(ctor, () => outcome(() => document.isHTMLElement(value)))).toBe(expected)
  }), { seed: 64, numRuns: 300 })
})

test("Document: escapeSelector is the host's CSS.escape, and a host without CSS is a defect when it runs", async () => {
  const host = globalThis as { CSS?: unknown }
  const original = host.CSS
  delete host.CSS
  const escaped = Effect.flatMap(Effect.service(Document.Document), (document) => document.escapeSelector("#a b"))
  try {
    expect(String(await Effect.runPromiseExit(Effect.provide(escaped, ExperimentalBrowserDocument.layer)))).toContain("CSS.escape")
    host.CSS = { escape: (value: string) => value.replaceAll(" ", "\\ ") }
    expect(await Effect.runPromise(Effect.provide(escaped, ExperimentalBrowserDocument.layer))).toBe("#a\\ b")
  } finally {
    if (original === undefined) delete host.CSS
    else host.CSS = original
  }
})

test("Document: layerTest answers false, keeps a selector as it is, and takes the members a test needs", async () => {
  const fake = new EventTarget() as unknown as globalThis.Document
  const read = Effect.flatMap(Effect.service(Document.Document), (document) =>
    Effect.map(document.escapeSelector("#a"), (selector) => [selector, document.isHTMLElement({})]))
  expect(await Effect.runPromise(Effect.provide(read, Document.layerTest(fake)))).toEqual(["#a", false])
  const given = Document.layerTest(fake, { escapeSelector: () => "x", isHTMLElement: (_): _ is HTMLElement => true })
  expect(await Effect.runPromise(Effect.provide(read, given))).toEqual(["x", true])
})


test("Document: CSS.escape delegation is cold, repeats host reads, preserves UTF-16 and defects (property)", async () => {
  const corpus = await Bun.file(new URL("./corpus/foldkit-scroll-to-anchor-css-escape.json", import.meta.url)).json()
  const host = globalThis as { CSS?: unknown }
  const had = "CSS" in host
  const original = host.CSS
  const document = browserDocument()
  const check = (input: string) => {
    const seen: Array<string> = []
    const first = { escape(value: string) { expect(this).toBe(first); seen.push(value); return "first:" + value } }
    const second = { escape(value: string) { expect(this).toBe(second); seen.push(value); return "second:" + value } }
    const effect = document.escapeSelector(input)
    expect(seen).toEqual([])
    host.CSS = first
    expect(Effect.runSync(effect)).toBe("first:" + input)
    host.CSS = second
    expect(Effect.runSync(effect)).toBe("second:" + input)
    expect(seen).toEqual([input, input])
    const failure = new Error("foldkit CSS host failure")
    host.CSS = { escape() { throw failure } }
    const exit = Effect.runSyncExit(effect)
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    expect(String(exit)).toContain(failure.message)
  }
  try {
    for (const input of corpus.inputs) check(input)
    const utf16 = fc.array(fc.integer({ min: 0, max: 65535 }), { maxLength: 128 }).map((units) => String.fromCharCode(...units))
    fc.assert(fc.property(utf16, check), { seed: 69, numRuns: 150 })
  } finally {
    if (had) host.CSS = original
    else delete host.CSS
  }
})

// VIP-9 document capability preserves native Document identity and event-map type; rule: docs/design/vips/0009-service-declarations.md#99e9cd6fc1fb1b10

// VIP-9 document capability preserves native Document identity and event-map type; rule: docs/design/vips/0009-service-declarations.md#57ce4b3d2fa39f54

// VIP-9 document capability preserves native Document identity and event-map type; rule: docs/design/vips/0009-service-declarations.md#529263766efb8f44

// VIP-9 document capability preserves native Document identity and event-map type; rule: docs/design/vips/0009-service-declarations.md#6d621961f08378b0

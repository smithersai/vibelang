// The page script of experimental-browser-services.test.ts: runs each browser service in Chromium over
// ExperimentalBrowserServices.layer, into `result`.
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import {
  Animations,
  AudioContext,
  BrowserInfo,
  Crypto,
  Document,
  FileReader,
  MediaQuery,
  ResizeObserver,
  Window
} from "vibelang-runtime/experimental"
import { ExperimentalBrowserServices } from "vibelang-runtime/experimental/platform-browser"

const sleep = (millis: number) => Effect.promise(() => new Promise((resolve) => setTimeout(resolve, millis)))

// Waits for what the host delivers, however long a loaded machine takes; the test's own timeout bounds it.
const until = (done: () => boolean) => Effect.gen(function*() {
  while (!done()) yield* sleep(5)
})

const program = Effect.gen(function*() {
  const mediaQuery = yield* MediaQuery.MediaQuery
  const animations = yield* Animations.Animations
  const reader = yield* FileReader.FileReader
  const observer = yield* ResizeObserver.ResizeObserver
  const page = yield* Document.Document
  const audio = yield* AudioContext.AudioContext
  const info = yield* BrowserInfo.BrowserInfo
  const view = yield* Window.Window
  const crypto = yield* Crypto.Crypto

  const blob = new Blob(["hi"], { type: "text/plain" })
  const box = document.body.appendChild(document.createElement("div"))
  box.id = "box"
  box.style.width = "10px"
  box.style.height = "10px"
  const style = yield* view.computedStyle(box)
  const width = style.width

  // The scope closes the context the layer opened; Chromium reports that as "closed".
  let opened: globalThis.AudioContext | undefined
  const openState = yield* Effect.scoped(Effect.map(audio.acquire, (context) => {
    opened = context
    return context.state
  }))
  const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  const utf8 = (text: string) => new TextEncoder().encode(text)

  const frame = yield* animations.nextFrame
  yield* animations.nextFrameUnless(() => undefined)
  const ownFrame = yield* animations.nextFrame
  const deltas = yield* Stream.runCollect(Stream.take(animations.frameDeltas, 2))

  const animation = box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 })
  yield* animations.settled("#box")
  const cancelled = box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60_000 })
  setTimeout(() => cancelled.cancel(), 20)
  yield* animations.settled("#box")
  yield* animations.settled("#missing")

  const resizes: Array<number> = []
  yield* Effect.scoped(Effect.gen(function*() {
    yield* observer.observe(box, (entries) => resizes.push(entries[0]!.contentRect.width))
    yield* until(() => resizes.length === 1)
    box.style.width = "20px"
    yield* until(() => resizes.length === 2)
  }))
  box.style.width = "30px"
  // Two frames: an observer still connected would deliver in the first.
  yield* animations.nextFrame
  yield* animations.nextFrame

  return {
    matches: yield* mediaQuery.matches("(min-width: 1px)"),
    malformed: yield* mediaQuery.matches("not a query (((("),
    changes: yield* Stream.runCollect(Stream.take(mediaQuery.changes("(min-width: 1px)"), 1)),
    frame: typeof frame === "number" && frame > 0,
    ownFrame: ownFrame >= frame,
    deltas: deltas.length === 2 && deltas.every((delta) => delta >= 0),
    finished: animation.playState,
    cancelled: cancelled.playState,
    text: yield* reader.readAsText(blob),
    dataUrl: yield* reader.readAsDataUrl(blob),
    bytes: (yield* reader.readAsArrayBuffer(blob)).byteLength,
    resizes,
    document: (yield* page.current) === document,
    window: (yield* view.current) === window,
    width,
    audio: [openState !== "closed", opened instanceof globalThis.AudioContext, opened?.state],
    isolated: yield* info.crossOriginIsolated,
    userAgent: (yield* info.userAgent) === navigator.userAgent,
    // RFC 4231 test case 2 and the SHA-256 of "abc" (FIPS 180-2), over the page's crypto.subtle.
    hmac: hex(yield* crypto.hmac("SHA-256", Redacted.make(utf8("Jefe")), utf8("what do ya want for nothing?"))),
    digest: hex(yield* crypto.digest("SHA-256", utf8("abc"))),
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(yield* crypto.randomUUIDv4())
  }
})

Effect.runPromise(Effect.provide(program, ExperimentalBrowserServices.layer)).then(
  (result) => Object.assign(globalThis, { result }),
  (error: unknown) => Object.assign(globalThis, { failure: String(error) })
)

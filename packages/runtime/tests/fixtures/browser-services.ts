// The page script of experimental-browser-services.test.ts: runs each browser service in Chromium over
// ExperimentalBrowserServices.layer, into `result`.
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import {
  Animations,
  Document,
  FileReader,
  MediaQuery,
  ResizeObserver
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

  const blob = new Blob(["hi"], { type: "text/plain" })
  const box = document.body.appendChild(document.createElement("div"))
  box.id = "box"
  box.style.width = "10px"
  box.style.height = "10px"

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
    document: (yield* page.current) === document
  }
})

Effect.runPromise(Effect.provide(program, ExperimentalBrowserServices.layer)).then(
  (result) => Object.assign(globalThis, { result }),
  (error: unknown) => Object.assign(globalThis, { failure: String(error) })
)

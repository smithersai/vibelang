// A worker of experimental-browser-services.test.ts: a worker has no matchMedia or document, and the bundle still
// builds, FileReader still reads, and a member that needs the page is a defect that names what is missing.
import * as Effect from "effect/Effect"
import { FileReader, MediaQuery } from "vibelang-runtime/experimental"
import { ExperimentalBrowserServices } from "vibelang-runtime/experimental/platform-browser"

const program = Effect.gen(function*() {
  const text = yield* (yield* FileReader.FileReader).readAsText(new Blob(["from a worker"]))
  const mediaQuery = yield* MediaQuery.MediaQuery
  const missing = yield* Effect.exit(mediaQuery.matches("print"))
  return { text, missing: String(missing).includes("window.matchMedia") }
})

Effect.runPromise(Effect.provide(program, ExperimentalBrowserServices.layer)).then(
  (result) => postMessage({ result }),
  (error: unknown) => postMessage({ failure: String(error) })
)

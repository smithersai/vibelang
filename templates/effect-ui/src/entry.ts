import { DevTools } from "@effect/ui-devtools"
import { BrowserHost } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import { Counter } from "./Counter.vibe"

const Main = BrowserHost.mount(Counter, {}, document.getElementById("root")!).pipe(
  Layer.provide(import.meta.env.DEV ? DevTools.layer() : Layer.empty)
)

Effect.runFork(Layer.launch(Main))

import { DevTools } from "@effect/ui-devtools"
import { BrowserHost } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import { SnakeWeb } from "./SnakeWeb.vibe"

const Main = BrowserHost.mount(SnakeWeb, {}, document.getElementById("root")!).pipe(
  Layer.provide(import.meta.env.DEV ? DevTools.layer() : Layer.empty)
)

Effect.runFork(Layer.launch(Main))

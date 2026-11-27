import { Router } from "@effect/ui"
import { DevTools } from "@effect/ui-devtools"
import { BrowserHost, BrowserRouter } from "@effect/ui/html"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { App } from "./App.vibe"
import { AppRoute } from "./routes.vibe"
import { DomainsHttpLive, DomainsSampleLive } from "./services/Domains.vibe"

const root = document.getElementById("app")!

const Main = BrowserHost.mount(App, Router.props(AppRoute), root).pipe(
  Layer.provide([
    BrowserRouter.layer({ routes: AppRoute }),
    import.meta.env.PROD
      ? DomainsSampleLive
      : DomainsHttpLive.pipe(Layer.provide(FetchHttpClient.layer)),
    import.meta.env.DEV ? DevTools.layer() : Layer.empty
  ])
)

Effect.runFork(Layer.launch(Main))

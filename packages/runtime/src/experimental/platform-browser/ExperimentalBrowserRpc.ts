/**
 * VIP-57: the browser host of `Experimental.Rpc`. `layer` spawns a worker
 * import's threads as module web workers; `runWorker` is what a worker entry
 * runs.
 *
 * @experimental
 * @since 0.0.14
 */
import * as BrowserRuntime from "@effect/platform-browser/BrowserRuntime"
import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner"
import * as Layer from "effect/Layer"
import * as Rpc from "../Rpc.js"
import * as internal from "../internal/rpcBrowser.js"
import * as ExperimentalBrowserServices from "./ExperimentalBrowserServices.js"

/**
 * Provides `Rpc.WorkerHost` in a browser. A module handle spawns the
 * runtime's generic entry, `ExperimentalBrowserRpcWorkerEntry.js`, as a module
 * worker with the module's URL in the entry URL's search parameters; an entry
 * handle spawns its script directly.
 *
 * @since 0.0.14
 */
export const layer: Layer.Layer<Rpc.WorkerHost> = internal.layer

/**
 * Serves the schema services `layer` provides to the page or worker that
 * spawned this worker, and runs until it closes the pool. `layer`'s
 * requirements are met by `ExperimentalBrowserServices.layer`.
 *
 * @since 0.0.14
 */
export const runWorker = <ROut, E>(layer: Layer.Layer<ROut, E, ExperimentalBrowserServices.ExperimentalBrowserServices>): void =>
  BrowserRuntime.runMain(Layer.launch(
    Rpc.serveWorker(Layer.provide(layer, ExperimentalBrowserServices.layer)).pipe(Layer.provide(BrowserWorkerRunner.layer))
  ))

// VIP-57: the browser worker host, apart from ExperimentalBrowserRpc so the
// services bundle can include it without an import cycle.
import * as BrowserWorker from "@effect/platform-browser/BrowserWorker"
import * as Layer from "effect/Layer"
import { WorkerHost } from "../Rpc.js"
import { entryWithModule } from "./rpcHost.js"

const entry = new URL("../platform-browser/ExperimentalBrowserRpcWorkerEntry.js", import.meta.url)

export const layer: Layer.Layer<WorkerHost> = Layer.succeed(WorkerHost, WorkerHost.of({
  spawn: (handle) =>
    BrowserWorker.layer((id) =>
      handle.spawn !== undefined ? handle.spawn(id) as Worker : new globalThis.Worker(handle.entry ? handle.url : entryWithModule(entry, handle.url), { type: "module" })
    )
}))

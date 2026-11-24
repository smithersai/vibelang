// VIP-57: the Bun worker host, apart from ExperimentalBunRpc so the services
// bundle can include it without an import cycle. Bun drops a worker URL's
// search parameters, so the module URL travels in `workerData`, which Bun's
// Worker accepts as Node's does.
import * as BunWorker from "@effect/platform-bun/BunWorker"
import * as Layer from "effect/Layer"
import { WorkerHost } from "../Rpc.js"
import { moduleParameter } from "./rpcHost.js"

const entry = new URL("../platform-bun/ExperimentalBunRpcWorkerEntry.js", import.meta.url)

export const layer: Layer.Layer<WorkerHost> = Layer.succeed(WorkerHost, WorkerHost.of({
  spawn: (handle) =>
    BunWorker.layer((id) =>
      handle.spawn !== undefined
        ? handle.spawn(id) as Worker
        : handle.entry
        ? new globalThis.Worker(handle.url, { type: "module" })
        : new globalThis.Worker(entry, { type: "module", workerData: { [moduleParameter]: handle.url.href } } as WorkerOptions)
    )
}))

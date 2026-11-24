// VIP-57: the Node worker host, apart from ExperimentalNodeRpc so the services
// bundle can include it without an import cycle.
import * as NodeWorker from "@effect/platform-node/NodeWorker"
import * as Layer from "effect/Layer"
import { Worker } from "node:worker_threads"
import { WorkerHost } from "../Rpc.js"
import { moduleParameter } from "./rpcHost.js"

const entry = new URL("../platform-node/ExperimentalNodeRpcWorkerEntry.js", import.meta.url)

export const layer: Layer.Layer<WorkerHost> = Layer.succeed(WorkerHost, WorkerHost.of({
  spawn: (handle) =>
    NodeWorker.layer((id) =>
      handle.spawn !== undefined
        ? handle.spawn(id) as Worker
        : handle.entry
        ? new Worker(handle.url)
        : new Worker(entry, { workerData: { [moduleParameter]: handle.url.href } })
    )
}))

/**
 * VIP-57: the generic Node worker entry. `ExperimentalNodeRpc.layer` spawns it
 * for a worker module and passes the module's URL in `workerData`; it imports
 * the module and serves its default-export layer.
 *
 * @experimental
 * @since 0.0.14
 */
import { workerData } from "node:worker_threads"
import { defaultLayer, moduleParameter } from "../internal/rpcHost.js"
import { runWorker } from "./ExperimentalNodeRpc.js"

const module = (workerData as Record<string, unknown> | null | undefined)?.[moduleParameter]
if (typeof module !== "string") {
  throw new Error("ExperimentalNodeRpcWorkerEntry: spawn it with ExperimentalNodeRpc.layer, which passes the worker module's URL")
}
runWorker(defaultLayer(module, await import(module)) as Parameters<typeof runWorker>[0])

/**
 * VIP-57: the Node host of `Experimental.Rpc`. `layer` spawns a worker
 * import's threads with `node:worker_threads`; `runWorker` is what a worker
 * entry runs.
 *
 * @experimental
 * @since 0.0.14
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner"
import * as Layer from "effect/Layer"
import * as Rpc from "../Rpc.js"
import * as internal from "../internal/rpcNode.js"
import * as ExperimentalNodeServices from "./ExperimentalNodeServices.js"

/**
 * Provides `Rpc.WorkerHost` on Node. A module handle spawns the runtime's
 * generic entry, `ExperimentalNodeRpcWorkerEntry.js`, which imports the
 * module; an entry handle spawns its script directly.
 *
 * @since 0.0.14
 */
export const layer: Layer.Layer<Rpc.WorkerHost> = internal.layer

/**
 * Serves the schema services `layer` provides to the thread that spawned this
 * one, and runs until that thread closes the pool. `layer`'s requirements are
 * met by `ExperimentalNodeServices.layer`.
 *
 * @since 0.0.14
 */
export const runWorker = <ROut, E>(layer: Layer.Layer<ROut, E, ExperimentalNodeServices.ExperimentalNodeServices>): void =>
  NodeRuntime.runMain(Layer.launch(
    Rpc.serveWorker(Layer.provide(layer, ExperimentalNodeServices.layer)).pipe(Layer.provide(NodeWorkerRunner.layer))
  ))

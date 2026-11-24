/**
 * VIP-57: the Bun host of `Experimental.Rpc`. `layer` spawns a worker
 * import's threads as Bun workers; `runWorker` is what a worker entry runs.
 *
 * @experimental
 * @since 0.0.14
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunWorkerRunner from "@effect/platform-bun/BunWorkerRunner"
import * as Layer from "effect/Layer"
import * as Rpc from "../Rpc.js"
import * as internal from "../internal/rpcBun.js"
import * as ExperimentalBunServices from "./ExperimentalBunServices.js"

/**
 * Provides `Rpc.WorkerHost` on Bun. A module handle spawns the runtime's
 * generic entry, `ExperimentalBunRpcWorkerEntry.js`, with the module's URL in
 * `workerData`; an entry handle spawns its script directly.
 *
 * @since 0.0.14
 */
export const layer: Layer.Layer<Rpc.WorkerHost> = internal.layer

/**
 * Serves the schema services `layer` provides to the thread that spawned this
 * one, and runs until that thread closes the pool. `layer`'s requirements are
 * met by `ExperimentalBunServices.layer`.
 *
 * @since 0.0.14
 */
export const runWorker = <ROut, E>(layer: Layer.Layer<ROut, E, ExperimentalBunServices.ExperimentalBunServices>): void =>
  BunRuntime.runMain(Layer.launch(
    Rpc.serveWorker(Layer.provide(layer, ExperimentalBunServices.layer)).pipe(Layer.provide(BunWorkerRunner.layer))
  ))

/**
 * VIP-57: the generic browser worker entry. `ExperimentalBrowserRpc.layer`
 * spawns it as a module worker with the worker module's URL in this entry's
 * search parameters; it imports the module and serves its default-export
 * layer.
 *
 * @experimental
 * @since 0.0.14
 */
import { defaultLayer, moduleFromEntry } from "../internal/rpcHost.js"
import { runWorker } from "./ExperimentalBrowserRpc.js"

const module = moduleFromEntry(import.meta.url) ?? moduleFromEntry(String((globalThis as { readonly location?: { readonly href?: unknown } }).location?.href ?? import.meta.url))
if (module === undefined) {
  throw new Error("ExperimentalBrowserRpcWorkerEntry: spawn it with ExperimentalBrowserRpc.layer, which passes the worker module's URL")
}
runWorker(defaultLayer(module, await import(/* @vite-ignore */ module)) as Parameters<typeof runWorker>[0])

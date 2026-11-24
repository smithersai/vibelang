// VIP-57 fixture: a self-contained worker entry, as a bundler plugin emits one
// for its target platform.
import { ExperimentalBunRpc } from "vibelang-runtime/experimental/platform-bun"
import { ExperimentalNodeRpc } from "vibelang-runtime/experimental/platform-node"
import layer from "./rpc-stats.mjs"

;(process.env.RPC_FIXTURE_PLATFORM === "bun" ? ExperimentalBunRpc : ExperimentalNodeRpc).runWorker(layer)

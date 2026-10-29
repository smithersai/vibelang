/**
 * The Node platform bundle with the `Experimental` services (D313).
 * `Locks` is left out: Node.js's locks coordinate one process's threads,
 * not processes, so a program provides `ExperimentalNodeLocks.layer` itself.
 *
 * @experimental
 * @since 0.0.11
 */
import * as EffectNodeServices from "@effect/platform-node/NodeServices"
import * as Layer from "effect/Layer"
import type * as Crypto from "../Crypto.js"
import type * as FileSystem from "../FileSystem.js"
import * as CryptoExtension from "../internal/crypto.js"
import * as FileSystemExtension from "../internal/nodeFileSystem.js"
import type * as Process from "../Process.js"
import * as ExperimentalNodeProcess from "./ExperimentalNodeProcess.js"

/**
 * The services of `@effect/platform-node`'s `NodeServices` and the
 * experimental ones.
 *
 * @since 0.0.11
 */
export type ExperimentalNodeServices =
  | EffectNodeServices.NodeServices
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Process.Process

/**
 * `@effect/platform-node`'s `NodeServices.layer` plus the experimental
 * services. `FileSystem` is built on Effect's `FileSystem` in that bundle,
 * so Effect's own users of it and the experimental one share one
 * implementation; `Crypto` is built on WebCrypto. Like Effect 4.1's bundle,
 * it provides none of Effect's crypto services: `ExperimentalNodeCrypto.layer`
 * provides them.
 *
 * @since 0.0.11
 */
export const layer: Layer.Layer<ExperimentalNodeServices> = Layer.provideMerge(
  Layer.mergeAll(
    CryptoExtension.layer,
    FileSystemExtension.layer,
    ExperimentalNodeProcess.layer
  ),
  EffectNodeServices.layer
)

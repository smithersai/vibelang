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
import type * as ChildProcess from "../ChildProcess.js"
import type * as Crypto from "../Crypto.js"
import type * as Headers from "../Headers.js"
import type * as FileSystem from "../FileSystem.js"
import type * as NodeStream from "../NodeStream.js"
import * as CryptoExtension from "../internal/crypto.js"
import * as FileSystemExtension from "../internal/nodeFileSystem.js"
import type * as Process from "../Process.js"
import type * as Stdio from "../Stdio.js"
import * as StdioExtension from "../internal/stdio.js"
import type * as Request from "../Request.js"
import * as ExperimentalNodeChildProcess from "./ExperimentalNodeChildProcess.js"
import * as ExperimentalNodeHeaders from "./ExperimentalNodeHeaders.js"
import * as ExperimentalNodeStream from "./ExperimentalNodeStream.js"
import * as ExperimentalNodeProcess from "./ExperimentalNodeProcess.js"
import * as ExperimentalNodeRequest from "./ExperimentalNodeRequest.js"

/**
 * The services of `@effect/platform-node`'s `NodeServices` and the
 * experimental ones.
 *
 * @since 0.0.11
 */
export type ExperimentalNodeServices =
  | EffectNodeServices.NodeServices
  | ChildProcess.ChildProcess
  | Crypto.Crypto
  | Headers.Headers
  | FileSystem.FileSystem
  | NodeStream.NodeStream
  | Process.Process
  | Stdio.Stdio
  | Request.Request

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
    ExperimentalNodeChildProcess.layer,
    ExperimentalNodeHeaders.layer,
    ExperimentalNodeStream.layer,
    ExperimentalNodeRequest.layer,
    CryptoExtension.layer,
    FileSystemExtension.layer,
    ExperimentalNodeProcess.layer,
    StdioExtension.layer
  ),
  EffectNodeServices.layer
)

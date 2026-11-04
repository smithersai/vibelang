/**
 * The Bun platform bundle with the `Experimental` services (D313). Bun has
 * no Web Locks, so it has no `Locks` layer.
 *
 * @experimental
 * @since 0.0.11
 */
import * as EffectBunServices from "@effect/platform-bun/BunServices"
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
import * as ExperimentalBunChildProcess from "./ExperimentalBunChildProcess.js"
import * as ExperimentalBunHeaders from "./ExperimentalBunHeaders.js"
import * as ExperimentalBunNodeStream from "./ExperimentalBunNodeStream.js"
import * as ExperimentalBunProcess from "./ExperimentalBunProcess.js"
import * as ExperimentalBunRequest from "./ExperimentalBunRequest.js"

/**
 * The services of `@effect/platform-bun`'s `BunServices` and the
 * experimental ones.
 *
 * @since 0.0.11
 */
export type ExperimentalBunServices =
  | EffectBunServices.BunServices
  | ChildProcess.ChildProcess
  | Crypto.Crypto
  | Headers.Headers
  | FileSystem.FileSystem
  | NodeStream.NodeStream
  | Process.Process
  | Stdio.Stdio
  | Request.Request

/**
 * `@effect/platform-bun`'s `BunServices.layer` plus the experimental
 * services. `FileSystem` is built on Effect's `FileSystem` in that bundle,
 * so Effect's own users of it and the experimental one share one
 * implementation; `Crypto` is built on WebCrypto. Like Effect 4.1's bundle,
 * it provides none of Effect's crypto services: `ExperimentalBunCrypto.layer`
 * provides them.
 *
 * @since 0.0.11
 */
export const layer: Layer.Layer<ExperimentalBunServices> = Layer.provideMerge(
  Layer.mergeAll(
    ExperimentalBunChildProcess.layer,
    ExperimentalBunHeaders.layer,
    ExperimentalBunNodeStream.layer,
    ExperimentalBunRequest.layer,
    CryptoExtension.layer,
    FileSystemExtension.layer,
    ExperimentalBunProcess.layer,
    StdioExtension.layer
  ),
  EffectBunServices.layer
)

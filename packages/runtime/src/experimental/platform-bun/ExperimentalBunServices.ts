/**
 * The Bun platform bundle with the `Experimental` services (D313). Bun has
 * no Web Locks, so it has no `Locks` layer.
 *
 * @experimental
 * @since 0.0.11
 */
import * as EffectBunServices from "@effect/platform-bun/BunServices"
import * as Layer from "effect/Layer"
import type * as Crypto from "../Crypto.js"
import type * as FileSystem from "../FileSystem.js"
import * as CryptoExtension from "../internal/crypto.js"
import * as FileSystemExtension from "../internal/nodeFileSystem.js"
import type * as Process from "../Process.js"
import * as ExperimentalBunProcess from "./ExperimentalBunProcess.js"

/**
 * The services of `@effect/platform-bun`'s `BunServices` and the
 * experimental ones.
 *
 * @since 0.0.11
 */
export type ExperimentalBunServices =
  | EffectBunServices.BunServices
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Process.Process

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
    CryptoExtension.layer,
    FileSystemExtension.layer,
    ExperimentalBunProcess.layer
  ),
  EffectBunServices.layer
)

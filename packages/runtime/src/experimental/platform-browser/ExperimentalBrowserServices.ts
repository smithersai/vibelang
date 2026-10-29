/**
 * The browser bundle of the `Experimental` services (D313).
 * `@effect/platform-browser` has no bundle of its own; a browser has no
 * file system and no process to read, so no `FileSystem` or `Process`
 * layer.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import type * as Crypto from "../Crypto.js"
import type * as Locks from "../Locks.js"
import * as ExperimentalBrowserCrypto from "./ExperimentalBrowserCrypto.js"
import * as ExperimentalBrowserLocks from "./ExperimentalBrowserLocks.js"

/**
 * The services of the browser bundle: the experimental `Crypto`, Effect's
 * crypto services from `@effect/platform-browser`, and `Locks`.
 *
 * @since 0.0.11
 */
export type ExperimentalBrowserServices = Crypto.Crypto | Layer.Success<typeof ExperimentalBrowserCrypto.layer> | Locks.Locks

/**
 * `ExperimentalBrowserCrypto.layer`, which provides the experimental `Crypto` and
 * `@effect/platform-browser`'s Effect crypto services, and `ExperimentalBrowserLocks.layer`.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<ExperimentalBrowserServices> = Layer.mergeAll(ExperimentalBrowserCrypto.layer, ExperimentalBrowserLocks.layer)

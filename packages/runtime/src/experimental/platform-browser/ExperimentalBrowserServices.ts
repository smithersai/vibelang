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
import type * as Animations from "../Animations.js"
import type * as FileReader from "../FileReader.js"
import type * as ResizeObserver from "../ResizeObserver.js"
import type * as Crypto from "../Crypto.js"
import type * as Locks from "../Locks.js"
import type * as MediaQuery from "../MediaQuery.js"
import * as ExperimentalBrowserAnimations from "./ExperimentalBrowserAnimations.js"
import * as ExperimentalBrowserFileReader from "./ExperimentalBrowserFileReader.js"
import * as ExperimentalBrowserResizeObserver from "./ExperimentalBrowserResizeObserver.js"
import * as ExperimentalBrowserCrypto from "./ExperimentalBrowserCrypto.js"
import * as ExperimentalBrowserLocks from "./ExperimentalBrowserLocks.js"
import * as ExperimentalBrowserMediaQuery from "./ExperimentalBrowserMediaQuery.js"

/**
 * The services of the browser bundle: the experimental `Crypto`, Effect's
 * crypto services from `@effect/platform-browser`, and the browser services.
 *
 * @since 0.0.11
 */
export type ExperimentalBrowserServices =
  | Animations.Animations
  | FileReader.FileReader
  | ResizeObserver.ResizeObserver
  | Crypto.Crypto
  | Layer.Success<typeof ExperimentalBrowserCrypto.layer>
  | Locks.Locks
  | MediaQuery.MediaQuery

/**
 * `ExperimentalBrowserCrypto.layer`, which provides the experimental `Crypto` and
 * `@effect/platform-browser`'s Effect crypto services, and each browser service's layer. A layer
 * reads the host only when a member runs, so a worker can provide the bundle.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<ExperimentalBrowserServices> = Layer.mergeAll(
  ExperimentalBrowserResizeObserver.layer,
  ExperimentalBrowserFileReader.layer,
  ExperimentalBrowserAnimations.layer,
  ExperimentalBrowserCrypto.layer,
  ExperimentalBrowserLocks.layer,
  ExperimentalBrowserMediaQuery.layer
)

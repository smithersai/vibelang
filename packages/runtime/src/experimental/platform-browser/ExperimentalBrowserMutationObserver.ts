/** @experimental @since 0.0.13 */
import * as Layer from "effect/Layer"
import * as MutationObserver from "../MutationObserver.js"

/** @category layers */
export const layer = Layer.succeed(MutationObserver.MutationObserver, MutationObserver.make({
  makeObserver: (callback) => new globalThis.MutationObserver(callback)
}))

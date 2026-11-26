/** @experimental @since 0.0.13 */
import * as Layer from "effect/Layer"
import * as IntersectionObserver from "../IntersectionObserver.js"

/** @category layers */
export const layer = Layer.succeed(IntersectionObserver.IntersectionObserver, IntersectionObserver.make({
  makeObserver: (callback, options) => new globalThis.IntersectionObserver(callback, options)
}))

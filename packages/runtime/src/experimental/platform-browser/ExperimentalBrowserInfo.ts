/**
 * The experimental `BrowserInfo` service for browsers, over
 * `window.crossOriginIsolated` and `navigator.userAgent`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import * as BrowserInfo from "../BrowserInfo.js"

const host = globalThis as {
  readonly crossOriginIsolated?: boolean
  readonly navigator?: { readonly userAgent?: string }
}

/**
 * Reads the host when a member runs, never when this module is imported or the
 * layer is built. A host without the field, such as a server, is not isolated
 * and has an empty user agent.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<BrowserInfo.BrowserInfo> = Layer.succeed(BrowserInfo.BrowserInfo, BrowserInfo.make({
  crossOriginIsolated: () => host.crossOriginIsolated === true,
  userAgent: () => host.navigator?.userAgent ?? ""
}))

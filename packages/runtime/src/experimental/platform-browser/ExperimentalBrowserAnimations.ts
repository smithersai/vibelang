/**
 * The experimental `Animations` service for browsers, over
 * `requestAnimationFrame` and `document`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import * as Animations from "../Animations.js"

// Reads `window`'s members and `document` from the host of the moment.
const scope = globalThis as unknown as Partial<Omit<Animations.Host, "now" | "querySelector">> & {
  readonly performance?: { readonly now: () => number }
  readonly document?: { readonly querySelector: (selector: string) => Animations.AnimatedLike | null }
}

const missing = (name: string) => new Error(`The Animations service needs ${name}: a browser page`)

const host: Animations.Host = {
  requestAnimationFrame: (callback) => {
    if (typeof scope.requestAnimationFrame !== "function") throw missing("window.requestAnimationFrame")
    return scope.requestAnimationFrame(callback)
  },
  cancelAnimationFrame: (id) => scope.cancelAnimationFrame?.(id),
  now: () => scope.performance?.now() ?? 0,
  querySelector: (selector) => {
    if (scope.document === undefined) throw missing("window.document")
    return scope.document.querySelector(selector)
  }
}

/**
 * Reads the host when a member runs, never when this module is imported or the
 * layer is built. A member that runs on a host without frames or a document is
 * a defect.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<Animations.Animations> = Layer.succeed(Animations.Animations, Animations.make(host))

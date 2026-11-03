/**
 * The experimental `Window` service for browsers, over `globalThis.window`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import * as Window from "../Window.js"

const window = (): globalThis.Window => {
  const host = globalThis as { readonly window?: globalThis.Window }
  if (host.window === undefined) {
    throw new Error("The Window service needs window: a browser page, not a worker or a server")
  }
  return host.window
}

/**
 * Reads the host when a member runs, never when this module is imported or the
 * layer is built. A member that runs on a host without a window is a defect.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<Window.Window> = Layer.succeed(Window.Window, Window.make({ window }))

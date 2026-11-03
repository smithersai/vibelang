/**
 * The experimental `AudioContext` service for browsers, over a host
 * `AudioContext`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import * as AudioContext from "../AudioContext.js"

const makeContext = (): globalThis.AudioContext => {
  const host = globalThis as { readonly AudioContext?: typeof globalThis.AudioContext }
  if (typeof host.AudioContext !== "function") {
    throw new Error("The AudioContext service needs window.AudioContext: a browser page, not a worker or a server")
  }
  return new host.AudioContext()
}

/**
 * Reads the host when a member runs, never when this module is imported or the
 * layer is built. A host without `AudioContext` fails `acquire` with a
 * `PlatformError`, as a host that refuses does.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<AudioContext.AudioContext> = Layer.succeed(AudioContext.AudioContext, AudioContext.make({ makeContext }))

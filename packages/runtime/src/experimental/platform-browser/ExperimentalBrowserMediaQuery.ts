/**
 * The experimental `MediaQuery` service for browsers, over `window.matchMedia`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import * as MediaQuery from "../MediaQuery.js"

const matchMedia = (query: string): MediaQuery.MediaQueryListLike => {
  const host = globalThis as unknown as Partial<MediaQuery.Host>
  if (typeof host.matchMedia !== "function") {
    throw new Error("The MediaQuery service needs window.matchMedia: a browser page, not a worker or a server")
  }
  return host.matchMedia(query)
}

/**
 * Reads the host when a member runs, never when this module is imported or the
 * layer is built, so a worker can provide the browser bundle and a server can
 * build a Stream. A member that runs on a host without `window.matchMedia` is a
 * defect.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<MediaQuery.MediaQuery> = Layer.succeed(MediaQuery.MediaQuery, MediaQuery.make({ matchMedia }))

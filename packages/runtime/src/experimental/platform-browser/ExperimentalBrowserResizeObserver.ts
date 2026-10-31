/**
 * The experimental `ResizeObserver` service for browsers, over a host
 * `ResizeObserver`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import * as ResizeObserver from "../ResizeObserver.js"

const makeObserver: ResizeObserver.Host["makeObserver"] = (callback) => {
  const host = globalThis as unknown as {
    readonly ResizeObserver?: new(callback: (entries: ReadonlyArray<ResizeObserverEntry>) => void) => ResizeObserver.ResizeObserverLike
  }
  if (typeof host.ResizeObserver !== "function") {
    throw new Error("The ResizeObserver service needs window.ResizeObserver: a browser page, not a worker or a server")
  }
  return new host.ResizeObserver(callback)
}

/**
 * Reads the host when a member runs, never when this module is imported or the
 * layer is built. A member that runs on a host without `ResizeObserver` is a
 * defect.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<ResizeObserver.ResizeObserver> = Layer.succeed(ResizeObserver.ResizeObserver, ResizeObserver.make({ makeObserver }))

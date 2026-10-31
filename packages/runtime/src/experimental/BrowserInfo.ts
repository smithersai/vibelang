/**
 * Facts about the browser, as Effects that cannot fail, as
 * `Experimental.Process` gives facts about a process.
 *
 * Effect 4.1.0 has no service for `window.crossOriginIsolated` or
 * `navigator.userAgent`.
 *
 * Layers: `ExperimentalBrowserInfo.layer` from
 * `vibelang-runtime/experimental/platform-browser`, also in its
 * `ExperimentalBrowserServices.layer`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/**
 * @category type ids
 * @since 0.0.11
 */
export type TypeId = "~vibelang/experimental/BrowserInfo"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/BrowserInfo"

/**
 * The slice of the host this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly crossOriginIsolated: () => boolean
  readonly userAgent: () => string
}

/**
 * Reads facts about the browser.
 *
 * @category models
 * @since 0.0.11
 */
export interface BrowserInfo {
  readonly [TypeId]: TypeId
  /** Whether the page can share memory with workers, as `window.crossOriginIsolated`. */
  readonly crossOriginIsolated: Effect.Effect<boolean>
  /** The `User-Agent` string, as `navigator.userAgent`. */
  readonly userAgent: Effect.Effect<string>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const BrowserInfo: Context.Service<BrowserInfo, BrowserInfo> = /* @__PURE__ */ Context.Service<BrowserInfo>(
  "vibelang/experimental/BrowserInfo"
)

/**
 * Builds the service over a host: the page, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): BrowserInfo => ({
  [TypeId]: TypeId,
  crossOriginIsolated: Effect.sync(host.crossOriginIsolated),
  userAgent: Effect.sync(host.userAgent)
})

/**
 * Provides a page that is not cross-origin isolated, whose user agent is
 * `"vibelang-test"`, for tests. Pass the members a test sets.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<BrowserInfo, TypeId>> = {}): Layer.Layer<BrowserInfo> =>
  Layer.succeed(BrowserInfo, {
    ...make({ crossOriginIsolated: () => false, userAgent: () => "vibelang-test" }),
    ...impl
  })

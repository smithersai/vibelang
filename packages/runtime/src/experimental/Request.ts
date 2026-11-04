/**
 * Native Web Request construction at a replacement URL.
 *
 * Effect's HTTP request model owns ordinary HTTP operations. This capability
 * preserves the native Request init fields and body/signal observations of
 * constructing a Request from a URL and an existing Request.
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
export type TypeId = "~vibelang/experimental/Request"
/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/Request"
/**
 * The injectable native constructor operation.
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly atUrl: (url: string, input: globalThis.Request) => globalThis.Request
}
/**
 * @category models
 * @since 0.0.11
 */
export interface Request {
  readonly [TypeId]: TypeId
  /** Constructs only when executed; native constructor exceptions are defects. */
  readonly atUrl: (url: string, input: globalThis.Request) => Effect.Effect<globalThis.Request>
}
/**
 * @category services
 * @since 0.0.11
 */
export const Request: Context.Service<Request, Request> = /* @__PURE__ */ Context.Service<Request>(
  "vibelang/experimental/Request"
)
/**
 * Builds over a constructor or a fake without reading the host.
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): Request => ({
  [TypeId]: TypeId,
  atUrl: (url, input) => Effect.sync(() => host.atUrl(url, input))
})
/**
 * Provides the test's constructor result without constructing a host object.
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Omit<Request, TypeId>): Layer.Layer<Request> =>
  Layer.succeed(Request, { [TypeId]: TypeId, ...impl })

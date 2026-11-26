/**
 * Native Web Response construction with standard body and header inputs.
 * @experimental
 * @since 0.0.13
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Response"
/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Response"
/**
 * The injectable native constructor operation.
 * @category models
 * @since 0.0.13
 */
export interface Host {
  readonly create: (body?: BodyInit | null, init?: ResponseInit) => globalThis.Response
}
/**
 * @category models
 * @since 0.0.13
 */
export interface Response {
  readonly [TypeId]: TypeId
  /** Constructs only when executed; native constructor exceptions are defects. */
  readonly create: (body?: BodyInit | null, init?: ResponseInit) => Effect.Effect<globalThis.Response>
}
/**
 * @category services
 * @since 0.0.13
 */
export const Response: Context.Service<Response, Response> = /* @__PURE__ */ Context.Service<Response>(
  "vibelang/experimental/Response"
)
/**
 * Builds over a constructor or a fake without reading the host.
 * @category constructors
 * @since 0.0.13
 */
export const make = (host: Host): Response => ({
  [TypeId]: TypeId,
  create: (body, init) => Effect.sync(() => host.create(body, init))
})
/**
 * Provides the test's constructor result without constructing a host object.
 * @category layers
 * @since 0.0.13
 */
export const layerTest = (impl: Omit<Response, TypeId>): Layer.Layer<Response> =>
  Layer.succeed(Response, { [TypeId]: TypeId, ...impl })

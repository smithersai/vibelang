/**
 * Native mutable Web Headers copies, preserving native duplicate cookies.
 * Effect's HTTP data models remain the ordinary protocol APIs.
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
export type TypeId = "~vibelang/experimental/Headers"
/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/Headers"
/**
 * The injectable native constructor operation.
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly copy: (input: globalThis.Headers) => globalThis.Headers
}
/**
 * @category models
 * @since 0.0.11
 */
export interface Headers {
  readonly [TypeId]: TypeId
  /** Constructs only when executed; native constructor exceptions are defects. */
  readonly copy: (input: globalThis.Headers) => Effect.Effect<globalThis.Headers>
}
/**
 * @category services
 * @since 0.0.11
 */
export const Headers: Context.Service<Headers, Headers> = /* @__PURE__ */ Context.Service<Headers>(
  "vibelang/experimental/Headers"
)
/**
 * Builds over a constructor or a fake without reading the host.
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): Headers => ({
  [TypeId]: TypeId,
  copy: input => Effect.sync(() => host.copy(input))
})
/**
 * Provides the test's constructor result without constructing a host object.
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Omit<Headers, TypeId>): Layer.Layer<Headers> =>
  Layer.succeed(Headers, { [TypeId]: TypeId, ...impl })

/**
 * Shared cold native Web Headers constructor layer.
 * @internal
 */
import * as Layer from "effect/Layer"
import * as Headers from "../Headers.js"

/** @internal */
export const layer: Layer.Layer<Headers.Headers> = /* @__PURE__ */ Layer.succeed(
  Headers.Headers,
  Headers.make({ copy: input => new globalThis.Headers(input) })
)

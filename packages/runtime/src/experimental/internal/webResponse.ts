/**
 * Shared cold native Web Response constructor layer.
 * @internal
 */
import * as Layer from "effect/Layer"
import * as Response from "../Response.js"

/** @internal */
export const layer: Layer.Layer<Response.Response> = /* @__PURE__ */ Layer.succeed(
  Response.Response,
  Response.make({ create: (body, init) => new globalThis.Response(body, init) })
)

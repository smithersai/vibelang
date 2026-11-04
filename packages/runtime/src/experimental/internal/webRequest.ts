/**
 * Shared cold native Web Request constructor layer.
 * @internal
 */
import * as Layer from "effect/Layer"
import * as Request from "../Request.js"

/** @internal */
export const layer: Layer.Layer<Request.Request> = /* @__PURE__ */ Layer.succeed(
  Request.Request,
  Request.make({ atUrl: (url, input) => new globalThis.Request(url, input) })
)

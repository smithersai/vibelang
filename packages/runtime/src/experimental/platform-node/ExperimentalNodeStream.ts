/**
 * The eager Web response-body bridge for Node-compatible HTTP adapters.
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import { Readable } from "node:stream"
import * as NodeStream from "../NodeStream.js"

/**
 * Native construction is deferred until the service operation executes.
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<NodeStream.NodeStream> = /* @__PURE__ */ Layer.succeed(
  NodeStream.NodeStream,
  NodeStream.make({
    makeReadableStream: source => new ReadableStream<Uint8Array>(source),
    fromWeb: stream => Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0])
  })
)

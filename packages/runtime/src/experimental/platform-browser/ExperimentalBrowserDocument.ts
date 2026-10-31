/**
 * The experimental `Document` service for browsers, over `window.document`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Layer from "effect/Layer"
import * as Document from "../Document.js"

const document = (): globalThis.Document => {
  const host = globalThis as { readonly document?: globalThis.Document }
  if (host.document === undefined) {
    throw new Error("The Document service needs window.document: a browser page, not a worker or a server")
  }
  return host.document
}

/**
 * Reads the host when a member runs, never when this module is imported or the
 * layer is built. A member that runs on a host without a document is a defect.
 *
 * @category layers
 * @since 0.0.11
 */
export const layer: Layer.Layer<Document.Document> = Layer.succeed(Document.Document, Document.make({ document }))

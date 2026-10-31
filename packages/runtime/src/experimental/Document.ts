/**
 * The page's `Document` as an Effect service.
 *
 * {@link Document.current} hands out the host object for the APIs that take
 * one, such as `Stream.fromEventListener`, whose listener runs in the dispatch
 * stack and can cancel the event. It is the real `Document`, so its event types
 * carry through; `EventTarget` would lose them. Reading it is the injected
 * step. Calling its members is the host's own code, which reads or changes the
 * page.
 *
 * Effect 4.1.0 has no service for the DOM. `BrowserStream` reads the document's
 * events into a Stream, after the dispatch has ended.
 *
 * Layers: `ExperimentalBrowserDocument.layer` from
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
export type TypeId = "~vibelang/experimental/Document"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/Document"

/**
 * The slice of the host this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly document: () => globalThis.Document
}

/**
 * Gives the page's document.
 *
 * @category models
 * @since 0.0.11
 */
export interface Document {
  readonly [TypeId]: TypeId
  /** The page's `Document`. */
  readonly current: Effect.Effect<globalThis.Document>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const Document: Context.Service<Document, Document> = /* @__PURE__ */ Context.Service<Document>(
  "vibelang/experimental/Document"
)

/**
 * Builds the service over a host: the page, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): Document => ({
  [TypeId]: TypeId,
  current: Effect.sync(host.document)
})

/**
 * Provides `document`, for tests: a fake, such as `new EventTarget()`, cast to
 * `Document`.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (document: globalThis.Document): Layer.Layer<Document> =>
  Layer.succeed(Document, make({ document: () => document }))

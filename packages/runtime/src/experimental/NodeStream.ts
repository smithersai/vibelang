/**
 * An eagerly owned Web response body for Node's HTTP response adapter.
 *
 * Effect's stream converter starts the reader on the first Node read. This
 * capability owns it when executed, so destroying an unpulled response body
 * cancels the Web reader. The native body is handed to HttpServerResponse.raw.
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
export type TypeId = "~vibelang/experimental/NodeStream"
/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/NodeStream"

/**
 * The response event slice used by this bridge.
 * @category models
 * @since 0.0.11
 */
export interface CloseTarget {
  readonly once: (event: "close", listener: () => void) => unknown
  readonly off: (event: "close", listener: () => void) => unknown
}

/**
 * The native readable slice needed by this bridge. The real implementation
 * returns a native Node Readable; this structural type keeps browser-only
 * consumers independent of Node's type packages.
 * @category models
 * @since 0.0.11
 */
export interface ReadableLike {
  readonly destroy: () => unknown
  readonly once: (event: "close", listener: () => void) => unknown
}

/**
 * The original response owner and the signal captured by the request.
 * Only the signal's current aborted flag is read; no abort listener is added.
 * @category models
 * @since 0.0.11
 */
export interface Options {
  readonly response: CloseTarget
  readonly signal: { readonly aborted: boolean }
}

/**
 * Native construction primitives, injectable without importing Node globals.
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly makeReadableStream: (source: UnderlyingDefaultSource<Uint8Array>) => ReadableStream<Uint8Array>
  readonly fromWeb: (stream: ReadableStream<Uint8Array>) => ReadableLike
}

/**
 * @category models
 * @since 0.0.11
 */
export interface NodeStream {
  readonly [TypeId]: TypeId
  /**
   * Eagerly owns the reader when executed. The native readable is destroyed on
   * response close, or immediately when the captured signal is already aborted.
   * Its close event removes only the bridge's response listener.
   *
   * The wrapper keeps native pull/cancel behavior and asynchronous error
   * ownership. Construction exceptions are defects. Ownership transfers to the
   * returned response body; this adds no Effect Scope finalizer.
   */
  readonly fromWeb: (body: ReadableStream<Uint8Array>, options: Options) => Effect.Effect<ReadableLike>
}

/**
 * @category services
 * @since 0.0.11
 */
export const NodeStream: Context.Service<NodeStream, NodeStream> = /* @__PURE__ */ Context.Service<NodeStream>(
  "vibelang/experimental/NodeStream"
)

/**
 * Builds over native constructors or injected test primitives.
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): NodeStream => ({
  [TypeId]: TypeId,
  fromWeb: (body, options) => Effect.sync(() => {
    const response = options.response, signal = options.signal
    const reader = body.getReader()
    const readable = host.fromWeb(host.makeReadableStream({
      async pull(controller) {
        const chunk = await reader.read()
        if (chunk.done) controller.close()
        else controller.enqueue(chunk.value)
      },
      cancel: reason => reader.cancel(reason)
    }))
    const destroyBody = () => readable.destroy()
    response.once("close", destroyBody)
    readable.once("close", () => response.off("close", destroyBody))
    if (signal.aborted) readable.destroy()
    return readable
  })
})

/**
 * Provides the test's body implementation without constructing native streams.
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Omit<NodeStream, TypeId>): Layer.Layer<NodeStream> =>
  Layer.succeed(NodeStream, { [TypeId]: TypeId, ...impl })

/**
 * The browser's `ResizeObserver` as an Effect service.
 *
 * {@link ResizeObserver.observe} runs its callback synchronously, before the
 * browser paints, so a layout it changes shows in the same frame. A Stream
 * would run after the paint.
 *
 * Effect 4.1.0 has no service for `ResizeObserver`. `BrowserStream` reads the
 * window's `resize` event, which an element's size does not fire.
 *
 * Layers: `ExperimentalBrowserResizeObserver.layer` from
 * `vibelang-runtime/experimental/platform-browser`, also in its
 * `ExperimentalBrowserServices.layer`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"

/**
 * @category type ids
 * @since 0.0.11
 */
export type TypeId = "~vibelang/experimental/ResizeObserver"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/ResizeObserver"

/**
 * The slice of a host `ResizeObserver` this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface ResizeObserverLike {
  readonly observe: (element: Element) => void
  readonly disconnect: () => void
}

/**
 * The slice of the host this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly makeObserver: (callback: (entries: ReadonlyArray<ResizeObserverEntry>) => void) => ResizeObserverLike
}

/**
 * Follows the size of an element.
 *
 * @category models
 * @since 0.0.11
 */
export interface ResizeObserver {
  readonly [TypeId]: TypeId
  /**
   * Runs `onResize` when `element` changes size, and once when it starts,
   * until the scope closes.
   */
  readonly observe: (
    element: Element,
    onResize: (entries: ReadonlyArray<ResizeObserverEntry>) => void
  ) => Effect.Effect<void, never, Scope.Scope>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const ResizeObserver: Context.Service<ResizeObserver, ResizeObserver> = /* @__PURE__ */ Context.Service<ResizeObserver>(
  "vibelang/experimental/ResizeObserver"
)

/**
 * Builds the service over a host: a real `ResizeObserver`, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): ResizeObserver => ({
  [TypeId]: TypeId,
  observe: (element, onResize) =>
    Effect.acquireRelease(
      Effect.sync(() => host.makeObserver(onResize)),
      (observer) => Effect.sync(() => observer.disconnect())
    ).pipe(Effect.flatMap((observer) => Effect.sync(() => observer.observe(element))))
})

/**
 * Provides an observer that never fires, for tests. Pass the members a test
 * needs.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<ResizeObserver, TypeId>> = {}): Layer.Layer<ResizeObserver> =>
  Layer.succeed(ResizeObserver, { [TypeId]: TypeId, observe: () => Effect.void, ...impl })

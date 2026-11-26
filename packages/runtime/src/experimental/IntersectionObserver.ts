/**
 * Scoped browser IntersectionObserver streams.
 * @experimental
 * @since 0.0.13
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/IntersectionObserver"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/IntersectionObserver"

/**
 * The slice of a host `IntersectionObserver` this service uses.
 *
 * @category models
 * @since 0.0.13
 */
export interface IntersectionObserverLike {
  readonly observe: (target: Element) => void
  readonly disconnect: () => void
}

/**
 * The slice of the host this service uses.
 *
 * @category models
 * @since 0.0.13
 */
export interface Host {
  readonly makeObserver: (callback: (entries: ReadonlyArray<IntersectionObserverEntry>) => void, options?: IntersectionObserverInit) => IntersectionObserverLike
}

/**
 * Streams individual intersection entries until the consumer closes.
 * @category models
 * @since 0.0.13
 */
export interface IntersectionObserver {
  readonly [TypeId]: TypeId
  readonly observe: (target: Element, options?: IntersectionObserverInit) => Stream.Stream<IntersectionObserverEntry>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.13
 */
export const IntersectionObserver: Context.Service<IntersectionObserver, IntersectionObserver> = /* @__PURE__ */ Context.Service<IntersectionObserver>(
  "vibelang/experimental/IntersectionObserver"
)

/**
 * Builds the service over a host: a real `IntersectionObserver`, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.13
 */
export const make = (host: Host): IntersectionObserver => ({
  [TypeId]: TypeId,
  observe: (target, options) =>
    Stream.callback<IntersectionObserverEntry>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => host.makeObserver((entries) => {
          Queue.offerAllUnsafe(queue, entries)
        }, options)),
        (observer) => Effect.sync(() => observer.disconnect())
      ).pipe(
        Effect.flatMap((observer) => Effect.sync(() => observer.observe(target))),
        Effect.andThen(Effect.never)
      ))
})

/**
 * Provides an observer that never fires, for tests. Pass the members a test
 * needs.
 *
 * @category layers
 * @since 0.0.13
 */
export const layerTest = (impl: Partial<Omit<IntersectionObserver, TypeId>> = {}): Layer.Layer<IntersectionObserver> =>
  Layer.succeed(IntersectionObserver, { [TypeId]: TypeId, observe: () => Stream.never, ...impl })

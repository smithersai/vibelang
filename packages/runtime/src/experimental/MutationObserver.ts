/**
 * Scoped browser MutationObserver streams.
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
export type TypeId = "~vibelang/experimental/MutationObserver"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/MutationObserver"

/**
 * The slice of a host `MutationObserver` this service uses.
 *
 * @category models
 * @since 0.0.13
 */
export interface MutationObserverLike {
  readonly observe: (target: Node, options: MutationObserverInit) => void
  readonly disconnect: () => void
}

/**
 * The slice of the host this service uses.
 *
 * @category models
 * @since 0.0.13
 */
export interface Host {
  readonly makeObserver: (callback: (entries: ReadonlyArray<MutationRecord>) => void) => MutationObserverLike
}

/**
 * Streams one array of mutation records per native callback until the consumer closes.
 * @category models
 * @since 0.0.13
 */
export interface MutationObserver {
  readonly [TypeId]: TypeId
  readonly observe: (target: Node, options: MutationObserverInit) => Stream.Stream<ReadonlyArray<MutationRecord>>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.13
 */
export const MutationObserver: Context.Service<MutationObserver, MutationObserver> = /* @__PURE__ */ Context.Service<MutationObserver>(
  "vibelang/experimental/MutationObserver"
)

/**
 * Builds the service over a host: a real `MutationObserver`, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.13
 */
export const make = (host: Host): MutationObserver => ({
  [TypeId]: TypeId,
  observe: (target, options) =>
    Stream.callback<ReadonlyArray<MutationRecord>>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => host.makeObserver((entries) => {
          Queue.offerUnsafe(queue, entries)
        })),
        (observer) => Effect.sync(() => observer.disconnect())
      ).pipe(
        Effect.flatMap((observer) => Effect.sync(() => observer.observe(target, options))),
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
export const layerTest = (impl: Partial<Omit<MutationObserver, TypeId>> = {}): Layer.Layer<MutationObserver> =>
  Layer.succeed(MutationObserver, { [TypeId]: TypeId, observe: () => Stream.never, ...impl })

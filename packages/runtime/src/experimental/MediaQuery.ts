/**
 * CSS media queries as an Effect service.
 *
 * {@link MediaQuery.matches} reads a query now; {@link MediaQuery.changes}
 * follows it. A malformed query does not fail: the host reads it as `not all`,
 * which never matches.
 *
 * Effect 4.1.0 has no service for `window.matchMedia`; `BrowserStream` reads
 * events of the window and the document, and a `MediaQueryList` is neither.
 *
 * Layers: `ExperimentalBrowserMediaQuery.layer` from
 * `vibelang-runtime/experimental/platform-browser`, also in its
 * `ExperimentalBrowserServices.layer`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

/**
 * @category type ids
 * @since 0.0.11
 */
export type TypeId = "~vibelang/experimental/MediaQuery"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/MediaQuery"

/**
 * The slice of a `MediaQueryList` this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface MediaQueryListLike {
  readonly matches: boolean
  readonly addEventListener: (type: "change", listener: (event: { readonly matches: boolean }) => void) => void
  readonly removeEventListener: (type: "change", listener: (event: { readonly matches: boolean }) => void) => void
}

/**
 * The slice of the host this service uses: `window`, or a fake in a test.
 *
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly matchMedia: (query: string) => MediaQueryListLike
}

/**
 * Reads CSS media queries.
 *
 * @category models
 * @since 0.0.11
 */
export interface MediaQuery {
  readonly [TypeId]: TypeId
  /** Whether `query` matches now. */
  readonly matches: (query: string) => Effect.Effect<boolean>
  /**
   * The current answer when the Stream starts, then each change, as
   * `SubscriptionRef.changes` is. Each run reads the host again. Ending the
   * Stream removes its listener.
   */
  readonly changes: (query: string) => Stream.Stream<boolean>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const MediaQuery: Context.Service<MediaQuery, MediaQuery> = /* @__PURE__ */ Context.Service<MediaQuery>(
  "vibelang/experimental/MediaQuery"
)

/**
 * Builds the service over a host: `window`, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): MediaQuery => ({
  [TypeId]: TypeId,
  matches: (query) => Effect.sync(() => host.matchMedia(query).matches),
  changes: (query) =>
    Stream.callback<boolean>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const list = host.matchMedia(query)
          const listener = (event: { readonly matches: boolean }): void => {
            Queue.offerUnsafe(queue, event.matches)
          }
          Queue.offerUnsafe(queue, list.matches)
          list.addEventListener("change", listener)
          return { list, listener }
        }),
        ({ list, listener }) => Effect.sync(() => list.removeEventListener("change", listener))
      ).pipe(Effect.andThen(Effect.never))
    )
})

/**
 * Provides queries that never match, for tests. Pass the members a test needs:
 * `changes` follows a given `matches`, stays open, and never emits a change
 * until the test gives its own.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<MediaQuery, TypeId>> = {}): Layer.Layer<MediaQuery> => {
  const matches = impl.matches ?? (() => Effect.succeed(false))
  return Layer.succeed(MediaQuery, {
    [TypeId]: TypeId,
    matches,
    changes: (query) => Stream.concat(Stream.fromEffect(matches(query)), Stream.never),
    ...impl
  })
}

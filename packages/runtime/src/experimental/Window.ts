/**
 * The page's `Window` as an Effect service.
 *
 * {@link Window.current} hands out the host object for the APIs that take one,
 * such as an event helper that filters inside the dispatch stack, and for a read
 * such as `location.origin`. It is the real `Window`, so its event types carry
 * through. `BrowserStream` reads the window's events after the dispatch has
 * ended.
 *
 * Layers: `ExperimentalBrowserWindow.layer` from
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
export type TypeId = "~vibelang/experimental/Window"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/Window"

/**
 * The slice of the host this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly window: () => globalThis.Window
}

/**
 * Gives the page's window.
 *
 * @category models
 * @since 0.0.11
 */
export interface Window {
  readonly [TypeId]: TypeId
  /** The page's `Window`, read each time this runs. */
  readonly current: Effect.Effect<globalThis.Window>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const Window: Context.Service<Window, Window> = /* @__PURE__ */ Context.Service<Window>(
  "vibelang/experimental/Window"
)

/**
 * Builds the service over a host: the page, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): Window => ({ [TypeId]: TypeId, current: Effect.sync(host.window) })

/**
 * Provides `window`, for tests: a fake, such as `new EventTarget()`, cast to
 * `Window`.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (window: globalThis.Window): Layer.Layer<Window> =>
  Layer.succeed(Window, make({ window: () => window }))

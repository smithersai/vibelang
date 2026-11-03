/**
 * The browser's Web Audio `AudioContext` as an Effect service.
 *
 * {@link AudioContext.acquire} opens a context that closes with the caller's
 * Scope, and hands out the real `AudioContext`: its graph of nodes is the host's
 * own API, which belongs in a `.ts` file or in `Effect.try`.
 *
 * Effect 4.1.0 has no service for Web Audio.
 *
 * Layers: `ExperimentalBrowserAudioContext.layer` from
 * `vibelang-runtime/experimental/platform-browser`, also in its
 * `ExperimentalBrowserServices.layer`.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import type * as Scope from "effect/Scope"

/**
 * @category type ids
 * @since 0.0.11
 */
export type TypeId = "~vibelang/experimental/AudioContext"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/AudioContext"

/**
 * The slice of the host this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly makeContext: () => globalThis.AudioContext
}

/**
 * Opens Web Audio contexts.
 *
 * @category models
 * @since 0.0.11
 */
export interface AudioContext {
  readonly [TypeId]: TypeId
  /**
   * A new `AudioContext`, closed when the scope closes unless already closed.
   * A rejected close does not fail the scope. A host that refuses
   * fails with a `PlatformError` whose `description` is its message.
   */
  readonly acquire: Effect.Effect<globalThis.AudioContext, PlatformError.PlatformError, Scope.Scope>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const AudioContext: Context.Service<AudioContext, AudioContext> = /* @__PURE__ */ Context.Service<AudioContext>(
  "vibelang/experimental/AudioContext"
)

/**
 * Builds the service over a host: the page, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): AudioContext => ({
  [TypeId]: TypeId,
  acquire: Effect.acquireRelease(
    Effect.try({
      try: () => host.makeContext(),
      catch: (cause) =>
        PlatformError.systemError({
          _tag: "Unknown",
          module: "AudioContext",
          method: "acquire",
          description: cause instanceof Error ? cause.message : String(cause),
          cause
        })
    }),
    // A context the program closed itself is closed already, and closing it again rejects.
    (context) => context.state === "closed" ? Effect.void : Effect.ignore(Effect.tryPromise(() => context.close()))
  )
})

/**
 * Provides a given context, for tests. It still closes with the scope.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (context: globalThis.AudioContext): Layer.Layer<AudioContext> =>
  Layer.succeed(AudioContext, make({ makeContext: () => context }))

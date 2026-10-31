/**
 * Animation frames and the Web Animations API as an Effect service.
 *
 * {@link Animations.nextFrame} waits for the next frame and
 * {@link Animations.frameDeltas} follows every frame.
 * {@link Animations.onNextFrame} registers in the caller's synchronous body,
 * for an `Effect.callback` whose check and registration must not be split.
 * {@link Animations.settled} waits for the animations of an element to end.
 *
 * Effect 4.1.0 has no service for `requestAnimationFrame` or
 * `Element.getAnimations`.
 *
 * Layers: `ExperimentalBrowserAnimations.layer` from
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
export type TypeId = "~vibelang/experimental/Animations"

/**
 * @category type ids
 * @since 0.0.11
 */
export const TypeId: TypeId = "~vibelang/experimental/Animations"

/**
 * The slice of an `Element` this service uses.
 *
 * @category models
 * @since 0.0.11
 */
export interface AnimatedLike {
  readonly getAnimations: () => ReadonlyArray<{ readonly finished: Promise<unknown> }>
}

/**
 * The slice of the host this service uses: `window` and `document`, or a fake
 * in a test.
 *
 * @category models
 * @since 0.0.11
 */
export interface Host {
  readonly requestAnimationFrame: (callback: (time: number) => void) => number
  readonly cancelAnimationFrame: (id: number) => void
  /** The clock frames are stamped by, as `performance.now`. */
  readonly now: () => number
  readonly querySelector: (selector: string) => AnimatedLike | null
}

/**
 * Waits for animation frames and animations.
 *
 * @category models
 * @since 0.0.11
 */
export interface Animations {
  readonly [TypeId]: TypeId
  /**
   * The timestamp of the next animation frame, in the milliseconds of
   * `performance.now`. Interrupting it cancels the frame.
   */
  readonly nextFrame: Effect.Effect<number>
  /**
   * Asks for `callback` to run inside the next animation frame, before this
   * returns, and gives the function that cancels it. It is a plain function
   * because a fiber can yield between two Effects: use it in the synchronous
   * body of an `Effect.callback` that checks something and then registers.
   * Everywhere else, use {@link Animations.nextFrame}.
   */
  readonly onNextFrame: (callback: (time: number) => void) => () => void
  /**
   * The milliseconds since the previous frame, once a frame; the first is since
   * the Stream started. The browser pauses frames in a hidden tab, so a delta
   * after one can be seconds long. Ending the Stream cancels the next frame.
   */
  readonly frameDeltas: Stream.Stream<number>
  /**
   * Waits a frame, so styles set just before apply, then waits for every
   * animation and transition on the first element that matches `selector`, or
   * completes when no element matches. An animation that is cancelled counts
   * as ended. An animation with infinite iterations never ends. A selector the
   * host rejects is a defect.
   */
  readonly settled: (selector: string) => Effect.Effect<void>
}

/**
 * The service key.
 *
 * @category services
 * @since 0.0.11
 */
export const Animations: Context.Service<Animations, Animations> = /* @__PURE__ */ Context.Service<Animations>(
  "vibelang/experimental/Animations"
)

/**
 * Builds the service over a host: `window` and `document`, or a fake in a test.
 *
 * @category constructors
 * @since 0.0.11
 */
export const make = (host: Host): Animations => {
  const onNextFrame = (callback: (time: number) => void) => {
    const id = host.requestAnimationFrame(callback)
    return () => host.cancelAnimationFrame(id)
  }
  const nextFrame = Effect.callback<number>((resume) => {
    const cancel = onNextFrame((time) => resume(Effect.succeed(time)))
    return Effect.sync(cancel)
  })
  return {
    [TypeId]: TypeId,
    nextFrame,
    onNextFrame,
    frameDeltas: Stream.callback<number>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const state = { id: 0, last: host.now() }
          const tick = (time: number): void => {
            Queue.offerUnsafe(queue, time - state.last)
            state.last = time
            state.id = host.requestAnimationFrame(tick)
          }
          state.id = host.requestAnimationFrame(tick)
          return state
        }),
        (state) => Effect.sync(() => host.cancelAnimationFrame(state.id))
      ).pipe(Effect.andThen(Effect.never))
    ),
    settled: (selector) =>
      Effect.andThen(nextFrame, Effect.promise(async () => {
        const animations = host.querySelector(selector)?.getAnimations() ?? []
        await Promise.allSettled(animations.map(({ finished }) => finished))
      }))
  }
}

/**
 * Provides animations that end at once, for tests: `nextFrame` and `settled`
 * complete, `onNextFrame` runs its callback in a microtask, all at time 0, and
 * `frameDeltas` stays open and gives nothing. Pass the members a test needs.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<Animations, TypeId>> = {}): Layer.Layer<Animations> =>
  Layer.succeed(Animations, {
    [TypeId]: TypeId,
    nextFrame: Effect.succeed(0),
    onNextFrame: (callback) => {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) callback(0)
      })
      return () => {
        cancelled = true
      }
    },
    frameDeltas: Stream.never,
    settled: () => Effect.void,
    ...impl
  })

/**
 * Animation frames and the Web Animations API as an Effect service.
 *
 * {@link Animations.nextFrame} waits for the next frame and
 * {@link Animations.frameDeltas} follows every frame.
 * {@link Animations.nextFrameUnless} checks for a pending commit and registers
 * it or a frame within one synchronous Effect registration boundary.
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
   * Checks for a pending commit and chooses its registration, or the next
   * frame, in one synchronous Effect registration boundary. The registrar
   * returns its cleanup when it registers a commit; undefined chooses a frame.
   * The Effect is cold. Interrupting it cancels the chosen registration.
   */
  readonly nextFrameUnless: (register: (resume: () => void) => (() => void) | undefined) => Effect.Effect<void>
  /**
   * The milliseconds since the previous frame, once a frame, never negative; the
   * first is since the Stream started. The browser pauses frames in a hidden tab, so a delta
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
    nextFrameUnless: (register) => Effect.callback<void>((resume) => {
      const finish = () => resume(Effect.void)
      const cancel = register(finish) ?? onNextFrame(finish)
      return Effect.sync(cancel)
    }),
    frameDeltas: Stream.callback<number>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const state = { id: 0, last: host.now() }
          const tick = (time: number): void => {
            // A timestamp is when the frame began, so one can precede a Stream that started during that frame.
            Queue.offerUnsafe(queue, Math.max(0, time - state.last))
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
 * complete, `nextFrameUnless` performs the same registration choice with a
 * microtask in place of a frame, and `frameDeltas` stays open and gives nothing.
 * Pass the members a test needs.
 *
 * @category layers
 * @since 0.0.11
 */
export const layerTest = (impl: Partial<Omit<Animations, TypeId>> = {}): Layer.Layer<Animations> =>
  Layer.succeed(Animations, {
    [TypeId]: TypeId,
    nextFrame: Effect.succeed(0),
    nextFrameUnless: (register) => Effect.callback<void>((resume) => {
      const finish = () => resume(Effect.void)
      const cancel = register(finish)
      if (cancel !== undefined) return Effect.sync(cancel)
      let cancelled = false
      queueMicrotask(() => { if (!cancelled) finish() })
      return Effect.sync(() => { cancelled = true })
    }),
    frameDeltas: Stream.never,
    settled: () => Effect.void,
    ...impl
  })

import { Context, Effect, Exit, Pull, Queue, Stream } from "effect"
import { $normal } from "./regions.js"
import { $iteratorFrame } from "./iterators.js"

// ---------------------------------------------------------------------------
// Producers (VIP-21)
//
// A producer is a generator function in a .vibe file that returns a Stream,
// as `async function*` returns an AsyncIterable. Calling it runs none of its
// body. Its Stream is Effect's Stream.callback with one element of buffer:
// each run starts the body on a fiber of its own, `yield v` offers v to the
// stream's queue, and Queue.end ends the stream when the body returns. The
// producer may run up to two elements ahead of its consumer, one in the
// buffer and one waiting to be offered; exact pull semantics, which would
// need a continuation runtime, are not provided.
// ---------------------------------------------------------------------------

/** The requirement a producer body has until $produce gives it a queue. */
export interface YieldOf<T> {
  readonly "~vibelang/Yield": T
}

type ElementOf<R> = R extends YieldOf<infer T> ? T : never

/** The queue of the producer whose body is running. */
class ProducerQueue extends Context.Service<ProducerQueue, Queue.Queue<unknown, unknown>>()("vibelang-runtime/ProducerQueue") {}

/** `yield value` in a producer: offer it to the producer's queue. */
export const $yield = <T>(value: T): Effect.Effect<void, never, YieldOf<T>> =>
  Effect.flatMap(Effect.service(ProducerQueue), (queue) => Queue.offer(queue, value)) as any

/** A producer: the Stream its call returns. */
export type Producer<T, E = never, R = never> = Stream.Stream<T, E, R>

/** VIP-21's buffer: one element, and an offer to a full buffer waits. */
const producerBuffer = { bufferSize: 1, strategy: "suspend" } as const

/**
 * A generator function's body becomes a producer: `function lines(path) {
 * return $produce(Effect.fnUntraced(function* lines() { … })) }`. Each run of
 * the Stream calls `body` again, so iterating it twice runs it twice.
 */
export const $produce = <E, R>(
  body: () => Effect.Effect<unknown, E, R>
): Producer<ElementOf<R>, E, Exclude<R, YieldOf<any>>> =>
  Stream.callback<unknown, E, any>((queue) =>
    Effect.andThen(
      Effect.provideService(Effect.suspend(body), ProducerQueue, queue as Queue.Queue<unknown, unknown>),
      Queue.end(queue)
    ), producerBuffer) as any

/** A completion record of a loop body, as the compiler's regions produce. */
type Completion = { readonly kind: string; readonly label?: string; readonly value?: unknown }

/**
 * `for (const x of iterable)` where `iterable` is a producer or a Stream. The
 * loop body is a region that returns a completion record, or nothing when no
 * jump leaves it. Nothing, `normal`, and a
 * `continue` that targets this loop, go on to the next element; a `break`
 * that targets this loop ends it normally; anything else ends the loop and is
 * returned for the enclosing code to dispatch.
 *
 * Over a Stream, a producer included, the loop pulls it with Stream.toPull
 * and closes it when the loop exits.
 */
export function $forOf<T, E, R, E2, R2>(
  iterable: Stream.Stream<T, E, R>,
  body: (value: T) => Effect.Effect<Completion | void, E2, R2>,
  label?: string
): Effect.Effect<Completion, E | E2, R | R2>
export function $forOf<T, E2, R2>(
  iterable: Iterable<T>,
  body: (value: T) => Effect.Effect<Completion | void, E2, R2>,
  label?: string
): Effect.Effect<Completion, E2, R2>
export function $forOf(
  iterable: unknown,
  body: (value: any) => Effect.Effect<Completion | void, any, any>,
  label?: string
): Effect.Effect<Completion, any, any> {
  // A body that no jump leaves returns nothing: normal completion.
  const own = (c: Completion) => c.label === "" || c.label === label
  const next = (c: Completion | void) => c === undefined || c.kind === "normal" || (c.kind === "continue" && own(c))
  const exit = (c: Completion | void): Completion => (c === undefined || c.kind === "break" && own(c) ? $normal : c)
  if (Stream.isStream(iterable)) {
    return Effect.scoped(Effect.gen(function*() {
      const pull = yield* Stream.toPull(iterable)
      while (true) {
        const chunk = yield* Effect.exit(pull)
        if (Exit.isFailure(chunk)) {
          if (Pull.isDoneCause(chunk.cause)) return $normal
          return yield* Effect.failCause(chunk.cause)
        }
        for (const value of chunk.value) {
          const c = yield* body(value)
          if (!next(c)) return exit(c)
        }
      }
    }))
  }
  // Native iteration owns the iterator protocol. The frame adapter unwinds it
  // when the body fails or the fiber is interrupted, and a return() that
  // throws is a defect beside that cause (D305).
  return Effect.gen($iteratorFrame(function*() {
    for (const value of iterable as Iterable<unknown>) {
      const c = yield* body(value)
      if (!next(c)) return exit(c)
    }
    return $normal
  }))
}

/**
 * `yield* iterable` in a producer: yields each element of another producer,
 * a Stream, or an iterable.
 */
export const $yieldAll = <T, E = never, R = never>(
  iterable: Stream.Stream<T, E, R> | Iterable<T>
): Effect.Effect<void, E, R | YieldOf<T>> =>
  Effect.asVoid($forOf(iterable as Iterable<unknown>, (value) => Effect.as($yield(value), $normal))) as any

/** Kept for code generated by the prototype compiler: a producer is a Stream already. */
export const $toStream = <T, E, R>(producer: Producer<T, E, R>): Stream.Stream<T, E, R> => producer

/** Kept for code generated by the prototype compiler: `$forOf` iterates Streams too. */
export const $forStream = $forOf

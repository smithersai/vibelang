import type { Deferred, Effect, Fiber } from "effect"

// Type-only recorder for vibelang --fix; no runtime implementation.
/** An element of an await operation's operand. */
// The declaration admits a Fiber and a Deferred only so that the compiler's
// EK4609 or EK4610 is the one error at such an element; no program that
// compiles passes one, and the operations do not wait for one (D394). A
// Deferred is invariant in its error type, and any is not assignable to
// never, so a Deferred that cannot fail needs its own member.
export type AwaitElement =
  | Effect.Effect<any, any, any>
  | Fiber.Fiber<any, any>
  | Deferred.Deferred<any, any>
  | Deferred.Deferred<any, never>

// The Effect an element's type stands for. A Fiber or a Deferred, which the
// compiler rejects, keeps the type of waiting for it, so the operation's type
// stays what the repair, join f or d.await(), gives it.
type ElementEffect<T> =
  T extends Fiber.Fiber<infer A, infer E> ? Effect.Effect<A, E>
  : T extends Deferred.Deferred<infer A, infer E> ? Effect.Effect<A, E>
  : T

type OperandEffects<Arg> =
  Arg extends ReadonlyArray<unknown> ? { -readonly [K in keyof Arg]: ElementEffect<Arg[K]> }
  : Arg extends Iterable<infer X> ? Iterable<ElementEffect<X>>
  : { -readonly [K in keyof Arg]: ElementEffect<Arg[K]> }

type AllOptions = {
  readonly concurrency?: number | "unbounded" | undefined
  readonly discard?: boolean | undefined
  readonly mode?: "default" | "result" | undefined
}

type AllReturn<Arg, O extends AllOptions> = OperandEffects<Arg> extends infer X extends
  | Iterable<Effect.Effect<any, any, any>>
  | Record<string, Effect.Effect<any, any, any>> ? Effect.All.Return<X, O>
  : never

type RaceElement<Arg> = Arg extends Iterable<infer X> ? ElementEffect<X> : never

type RaceReturn<Arg> = Effect.Effect<
  Effect.Success<RaceElement<Arg>>,
  Effect.Error<RaceElement<Arg>>,
  Effect.Services<RaceElement<Arg>>
>


export declare function $awaitAll<Arg extends Iterable<AwaitElement> | readonly [] | Record<string, AwaitElement>>(operand: Arg): AllReturn<Arg, { readonly concurrency: "unbounded" }>;
export declare function $awaitAllSettled<Arg extends Iterable<AwaitElement> | readonly [] | Record<string, AwaitElement>>(operand: Arg): AllReturn<Arg, { readonly concurrency: "unbounded"; readonly mode: "result" }>;
export declare function $awaitRace<Arg extends Iterable<AwaitElement>>(operand: Arg): RaceReturn<Arg>;
export declare function $awaitAny<Arg extends Iterable<AwaitElement>>(operand: Arg): RaceReturn<Arg>;

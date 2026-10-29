/// <reference lib="esnext.disposable" />
// Effect 4.0.6 exposes disposal protocols even when the source uses no using.
// The prelude of VibeLang's TypeScript 7 content mapper. Every file the mapper
// projects starts with one import from this module:
//
//   import { Effect, Layer, $gen, $run, ... } from "vibelang-ts-mapper/prelude"; true satisfies $PreludeLoaded;
//
// It imports the prelude names the file uses and does not declare itself
// (D4, D48, D146, D151), as the fork resolves them, and the helpers the
// projection writes, under names that no identifier of the file uses.
//
// These declarations are types only: tsc emits no JavaScript for a mapped
// file, so nothing here runs. The projector that writes the calls lives in
// typescript/tsc/internal/vibelangmapper. Namespaces are re-exported straight
// from effect, so a declaration file that names Effect.Effect, Layer.Layer,
// or Option.Option names effect's own modules.

import type * as EffectModule from "effect/Effect"
import type * as ScopeModule from "effect/Scope"
import type * as StreamModule from "effect/Stream"
import type { Cause, Config, Context, Exit, Fiber } from "effect"
import type * as Runtime from "vibelang-runtime"

// ---------------------------------------------------------------- prelude names

// D4, D146: effect's root modules, every one in scope in a .vibe file.
export {
  Arbitrary, Array, BigDecimal, BigInt, Boolean, Brand, ByteSize, Cache, Cause, Channel, ChannelSchema, Chunk,
  Clock, Combiner, Config, ConfigProvider, Console, Context, Cron, Crypto, Data, DateTime, Deferred, Differ,
  Duration, Effect, Effectable, Equal, Equivalence, ErrorReporter, ExecutionPlan, Exit, Fiber, FiberHandle,
  FiberMap, FiberSet, FileSystem, Filter, Formatter, Function, Graph, Hash, HashMap, HashRing, HashSet, HKT,
  Inspectable, Iterable, JsonPatch, JsonPointer, JsonSchema, Latch, Layer, LayerMap, LayerRef, Logger, LogLevel,
  ManagedRuntime, Match, Metric, MutableHashMap, MutableHashSet, MutableList, MutableRef, Newtype,
  NonEmptyIterable, Number, Optic, Option, Order, Ordering, PartitionedSemaphore, Path, Pipeable, PlatformError,
  Pool, Predicate, PrimaryKey, PubSub, Pull, Queue, Random, RcMap, RcRef, Record, Redactable, Redacted, Reducer,
  Ref, References, RegExp, Request, RequestResolver, Resource, Result, Runtime, Schedule, Scheduler, Schema,
  SchemaAST, SchemaGetter, SchemaIssue, SchemaParser, SchemaRepresentation, SchemaTransformation, Scope,
  ScopedCache, ScopedRef, Semaphore, Sink, StandardSchema, Stdio, Stream, String, Struct, SubscriptionRef, Symbol,
  SynchronizedRef, Take, Terminal, Tracer, Trie, Tuple, TxChunk, TxDeferred, TxHashMap, TxHashSet,
  TxPriorityQueue, TxPubSub, TxQueue, TxReentrantLock, TxRef, TxSemaphore, TxSubscriptionRef, Types, UndefinedOr,
  Unify, Utils, Version,
  absurd, cast, flow, hole, identity
} from "effect"

/** D4: in a .vibe file, `Effect<A, E, R>` is `Effect.Effect<A, E, R>`. */
export type Effect<A, E = never, R = never> = EffectModule.Effect<A, E, R>;

/** D48: in a .vibe file, the type `Scope` is `Scope.Scope`. */
export type Scope = ScopeModule.Scope;

// D151: the Effect functions a .vibe file calls without the Effect. prefix.
export {
  all, die, exit, forEach, log, logDebug, logError, logInfo, logWarning, race, repeat, retry, sleep, timeout, withSpan
} from "effect/Effect"

// The runtime's prelude names (the fork's prelude.go).
export {
  TaggedError, Control, pipe, wire, fork, handle, resume, resumeWith, abandon, sync, callback, Resume, runPromise,
  runFork, runSync, runCallback, detach, forkIn, interrupt, yieldNow, uninterruptible, restore, interruptible,
  customMatcher, Experimental
} from "vibelang-runtime"

/** D5/D54: shipped built-in failures use the same value boundary as trusted implementations. */
export { $trusted } from "vibelang-runtime"
/** A syntax-proven D54 synchronous entry in a plain callback. */
export declare function $plain<Args extends unknown[], A>(fn: (...args: Args) => EffectModule.Effect<A, never, never>): (...args: Args) => A

// D268: the phantom brand changes callback typing; only the marker controls execution.
export type $Plain<F> = F extends (...args: infer Args) => EffectModule.Effect<infer A, infer _E, infer _R> ? (...args: Args) => A : F
export declare function $adapt<P>(fn: { readonly $plain: P }): P
export declare function $adapt<F>(fn: F): F

/** Preserve a built-in's optional parameters before entering its failure boundary. */
export type $BuiltinArgs<F extends (...args: any[]) => any> = Parameters<F>
/** Keep the shipped failure class in E rather than widening its constructor to Error. */
export type $BuiltinResult<F extends (...args: any[]) => any> = ReturnType<F>

// ---------------------------------------------------------------- helpers

// The runtime's region helpers (D13, D15, D132, D173): regions, handle
// statements, and provide blocks lower onto these.
export { $catch, $finally, $tailResume, $tailResumeWith, $provideEntries, $provideService } from "vibelang-runtime"

/**
 * `using x = acquire()` in an Effect body (D47, D94, D14): the block's Scope
 * holds an acquisition, which removes Scope from the acquisition's R; any
 * other value is a Disposable the block releases.
 */
export declare function $acquire<A, E, R>(acquisition: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, Exclude<R, ScopeModule.Scope>>
export declare function $acquire<T>(value: T): EffectModule.Effect<T, never, never>

/**
 * A block that holds a using or a fork (D14, D19) runs as a region under
 * $scopedBody, whose Scope ends with the block; it is Effect.scoped at run
 * time. In types it is the identity: $acquire and $scoped already remove
 * Scope from what they add to R.
 */
export declare function $scopedBody<A, E, R>(program: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>

/** A block owns the fork's Scope (D19, D96), but the child's own R,
 * including a Scope needed by an acquisition, still belongs to the caller.
 * Select the scoped signature before calling: after R | Scope is formed,
 * subtracting Scope would erase the child's requirement as well. */
export declare function $scoped(fork: typeof Runtime.fork): {
  <A, E, R>(program: EffectModule.Effect<A, E, R>, options?: Parameters<typeof Runtime.fork>[1]): EffectModule.Effect<Fiber.Fiber<A, E>, never, R>
  (options?: Parameters<typeof Runtime.fork>[1]): <A, E, R>(program: EffectModule.Effect<A, E, R>) => EffectModule.Effect<Fiber.Fiber<A, E>, never, R>
}

// finally (exit) { ... } (D178), and the interruption blocks (D179, D180).
export { $finallyExit } from "vibelang-runtime"

// D209/D218/D238: retain the original constituent when its tag is a
// singleton literal, so a predicate's false branch excludes it entirely.
// Broad or union tags retain their unmatched possibilities.
export type $TagMatch<T, K extends string> = T extends { readonly _tag: K }
  ? T
  : T & { readonly _tag: K }

// The pattern matching helpers the parser writes for match and is (D206-D225).
export { $is, $extract, $rest, $noMatch, $patternError } from "vibelang-runtime"

// D196: concurrent programs and held Fibers/Deferreds keep the runtime's
// tuple, record, result, and race channel inference under stock TypeScript.
export { $awaitAll, $awaitAllSettled, $awaitRace, $awaitAny } from "vibelang-runtime"

/*
 * Completion records, as the checker sees them. A return in a region's
 * block returns $box(value): the value itself, joined with a brand, so the
 * block's generator never infers a single literal type and widens it on its
 * own; the enclosing function's own return, after $returned removes the
 * brand, sees every return site at once and widens as TypeScript would for
 * the source. A break or continue that leaves the region returns
 * $jump("break:label"), and a block that ends normally returns $end. (The
 * runtime's records are { kind, value } objects; their property would widen
 * an inferred literal union.)
 */
declare const endBrand: unique symbol
declare const jumpBrand: unique symbol
declare const boxBrand: unique symbol
/** What a region's return adds to its value. */
export interface $Boxed {
  readonly [boxBrand]: true
}
/** A return in a region's block: its value, unwidened. */
export declare function $box<T>(value: T): T | $Boxed
/** The normal end of a region's block. */
export declare const $end: { readonly [endBrand]: true }
/** A break or continue that leaves a region: "break:label" or "continue:label". */
export interface $Jump<K extends string> {
  readonly [jumpBrand]: K
}
export declare function $jump<const K extends string>(kind: K): $Jump<K>
/** A completion that can only be a return's value: the value, unboxed. */
export declare function $unboxed<T>(completion: T): Exclude<T, $Jump<string> | typeof $end | $Boxed>
/** The completion is a return's value. */
export declare function $returned<T>(completion: T): completion is Exclude<T, $Jump<string> | typeof $end | $Boxed>
/** The completion is the jump kind. */
export declare function $jumped<T, const K extends string>(completion: T, kind: K): completion is Extract<T, $Jump<K>>

type AnyEffect = EffectModule.Effect<any, any, any>

/**
 * The E and R of what a generator yields, member by member: a union of the
 * yielded Effects' channels without subtype reduction, as the fork joins
 * them. (Effect.gen's own [Eff] extends [Effect<…, infer E, …>] merges the
 * candidates with subtype reduction, so an error that structurally extends
 * another, such as a TaggedError with a name field, would vanish from E.)
 */
type YieldE<Eff> = Eff extends EffectModule.Effect<infer _A, infer E, infer _R> ? E : never
type YieldR<Eff> = Eff extends EffectModule.Effect<infer _A, infer _E, infer R> ? R : never

// Keep the value and channels inferred even in a rejected body. A non-iterable
// $run result would poison those declarations with any/unknown (gate 1).
type DataRunAnnotation = "D251: data in a run position; wrap the call in sync((): Exit.Exit<A, E> => call()) to keep it data"
type ValidYields<Y> = [Extract<Y, DataRunAnnotation>] extends [never] ? unknown : DataRunAnnotation

/** A function body: `function f() { body }` projects to `function f() { return $gen(function* () { body }) }`. */
export declare function $gen<Eff, AEff>(f: (() => Generator<Eff, AEff, never>) & ValidYields<Eff>): EffectModule.Effect<AEff, YieldE<Eff>, YieldR<Eff>>
export declare function $gen<Self, Eff, AEff>(
  options: { readonly self: Self },
  f: ((this: Self) => Generator<Eff, AEff, never>) & ValidYields<Eff>
): EffectModule.Effect<AEff, YieldE<Eff>, YieldR<Eff>>

/** D24 data that $isRun can identify stays data at opaque calls (D254). */
type DataEffect = (AnyEffect & { readonly sql: string }) | Config.Config<any> | Context.Key<any, any> | Error | Cause.YieldableError

/** Only Exit needs an annotation: runtime identity also marks succeed programs. */
type RejectedEffect = Exit.Exit<any, any>

/** The members of T that run: Effects that are not data subtypes. */
type Running<T> = Extract<Exclude<T, DataEffect | RejectedEffect>, AnyEffect>

/** Accepts T only when some member of T runs, so a union without an Effect falls through. */
type HasRunning<T> = [Running<T>] extends [never] ? never : unknown

/**
 * Runs a call (L3): a call `c` in an Effect body projects to
 * `(yield* $run(c))`. An Effect runs and gives its success type; a union
 * runs its Effect members, so `Effect<A, E, R> | U` gives `A | U`. Data
 * subtypes stay data; only Exit requires an annotation (D251, D254).
 * Values of other types and a type parameter's values are data, lifted to
 * an Effect that succeeds with them. Overloads, not a conditional
 * type, so a generic body's `T | undefined` resolves to data instead of a
 * deferred type (research/typedirected.md section 6.5).
 */
// An any-valued foreign result is not evidence of a data subtype. Resolve it
// before contextual cast typing can invent a DataEffect intersection.
export declare function $run<T>(value: T & (0 extends 1 & T ? unknown : never)): EffectModule.Effect<T, never, never>
export declare function $run<T>(value: T & RejectedEffect): Generator<DataRunAnnotation, T, any>
// Also reject a union containing Exit; it must not fall through as a program.
export declare function $run<T>(value: T & ([Extract<T, RejectedEffect>] extends [never] ? never : unknown)): Generator<DataRunAnnotation, T, any>
export declare function $run<T>(value: T & DataEffect): EffectModule.Effect<T, never, never>
// Preserve data members of a union before the ordinary Effect overload.
export declare function $run<T>(value: T & ([Extract<T, DataEffect>] extends [never] ? never : unknown)): EffectModule.Effect<
  EffectModule.Success<Running<T>> | Exclude<T, Running<T>>,
  EffectModule.Error<Running<T>>,
  EffectModule.Services<Running<T>>
>
export declare function $run<A, E, R>(value: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>
export declare function $run<T>(value: T & HasRunning<T>): EffectModule.Effect<
  EffectModule.Success<Running<T>> | Exclude<T, Running<T>>,
  EffectModule.Error<Running<T>>,
  EffectModule.Services<Running<T>>
>
export declare function $run<T>(value: T): EffectModule.Effect<T, never, never>

// ---------------------------------------------------------------- producers

declare const emitBrand: unique symbol
/** What a producer's `yield x` yields: x, as an element of its Stream (D26). */
export interface $Emit<A> {
  readonly [emitBrand]: A
}
/** `yield x` in a producer projects to `yield $emit(x)`. */
export declare function $emit<A>(value: A): $Emit<A>
type Emitted<Y> = Y extends $Emit<infer A> ? A : never

/**
 * A producer, a generator function in a .vibe file (D26):
 * `function* f() { body }` projects to `function f() { return $produce(function* () { body }) }`.
 * Its Stream's A is what it emits; E and R are what it runs.
 */
export declare function $produce<Y>(
  body: (() => Generator<Y, unknown, any>) & ValidYields<Y>
): StreamModule.Stream<Emitted<Y>, YieldE<Exclude<Y, $Emit<any>>>, YieldR<Exclude<Y, $Emit<any>>>>
export declare function $produce<Self, Y>(
  options: { readonly self: Self },
  body: ((this: Self) => Generator<Y, unknown, any>) & ValidYields<Y>
): StreamModule.Stream<Emitted<Y>, YieldE<Exclude<Y, $Emit<any>>>, YieldR<Exclude<Y, $Emit<any>>>>

/** `yield* p` in a producer emits each element of the producer or Stream p. */
export declare function $delegate<A, E, R>(
  producer: StreamModule.Stream<A, E, R>
): Generator<$Emit<A> | EffectModule.Effect<never, E, R>, void, unknown>
export declare function $delegate<T>(iterable: Iterable<T>): Generator<$Emit<T>, void, unknown>

/**
 * A for...of in an Effect body or a producer iterates `(yield* $each(xs))`:
 * a Stream's elements, with its E and R, or an iterable as itself (D26).
 * The iterable overload comes first, so a value of type any iterates as
 * any, adding nothing to E and R; a Stream is not iterable.
 */
export declare function $each<T>(iterable: Iterable<T>): EffectModule.Effect<Iterable<T>, never, never>
export declare function $each<A, E, R>(stream: StreamModule.Stream<A, E, R>): EffectModule.Effect<Iterable<A>, E, R>

/**
 * L1's dual form: a parameterless lambda that is both a program and a
 * function that returns it, `() => body` at a position that accepts either.
 */
export declare function $dual<A, E, R>(program: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R> & (() => EffectModule.Effect<A, E, R>)

/**
 * A function value at a position that takes a program (D7): the function
 * runs as a cold program, preserving either its Effect or its plain result.
 * Any other value is itself.
 */
export declare function $sync<A>(f: () => A): EffectModule.Effect<A, never, never>
export declare function $asProgram<T>(value: T & (0 extends 1 & T ? unknown : never)): T
export declare function $asProgram<T>(f: () => (T & (0 extends 1 & T ? unknown : never))): EffectModule.Effect<T, never, never>
export declare function $asProgram<T>(f: () => (T & ([Extract<T, RejectedEffect>] extends [never] ? never : unknown))): Generator<DataRunAnnotation, T, any>
export declare function $asProgram<T>(f: () => (T & DataEffect)): EffectModule.Effect<T, never, never>
export declare function $asProgram<A, E, R>(f: () => EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>
export declare function $asProgram<A>(f: () => A): EffectModule.Effect<A, never, never>
export declare function $asProgram<T>(value: T): T

/** `throw x` in an Effect body projects to `return yield* $fail(x)`. */
export declare function $fail<E>(value: E): EffectModule.Effect<never, E>

/**
 * D278: the base of an error that extends another error,
 * `class Missing extends $errorSubclass(NotFound, "Missing")`, tagged with
 * its own name.
 */
export declare const $errorSubclass: typeof Runtime.$errorSubclass
/** D278: what the constructor of a subclass with fields and no constructor takes. */
export type $ErrorArgs<B, A> = Runtime.$ErrorArgs<B, A>

/**
 * The base of a service, a control, or a D1 abstract class (D1, D45):
 * `abstract class Users extends $service<Users>("pkg/users#Users") {}`.
 */
export declare const $service: typeof Runtime.$service

/**
 * The base of a service that declares `static readonly default` (D40): a
 * Context.Reference, which needs no provider and joins no R. Types only;
 * the executable rendering passes the default.
 */
export declare function $reference<I>(key: string): Runtime.ReferenceKey<I>

declare const inferred: unique symbol
/** A contract channel written `infer` (D57), or dependencies left out of a function's contract. */
export type $Infer = typeof inferred
type Pin<Written, Inferred> = [Written] extends [$Infer] ? Inferred : Written

/**
 * A written contract with an `infer` channel (D57):
 * `function f(): A!infer E!R { body }` projects to
 * `function f() { return $contract<A, $Infer, R>()($gen(function* () { body })) }`.
 * The written channels are checked and pinned; the inferred ones come from the body.
 */
export declare function $contract<A, E, R>(): <A2 extends Pin<A, unknown>, E2 extends Pin<E, unknown>, R2 extends Pin<R, unknown>>(
  effect: EffectModule.Effect<A2, E2, R2>
) => EffectModule.Effect<Pin<A, A2>, Pin<E, E2>, Pin<R, R2>>

/** D41: callable and Effect members add the service to R. Plain fields stay
 * non-callable; read them with Key().field rather than inventing a call. */
type Accessors<I, S> = {
  readonly [M in keyof S]: S[M] extends (...args: infer P extends readonly unknown[]) => EffectModule.Effect<infer A, infer E, infer R>
    ? (...args: P) => EffectModule.Effect<A, E, R | I>
    : S[M] extends (...args: infer P extends readonly unknown[]) => infer B
      ? (...args: P) => EffectModule.Effect<B, never, I>
      : S[M] extends EffectModule.Effect<infer A, infer E, infer R>
        ? EffectModule.Effect<A, E, R | I>
        : S[M]
}

/**
 * A member call on a possible service key (D41): `Users.find(id)` projects to
 * `$use(Users).find(id)`. A Context key's members are its service's, with the
 * service added to R, and the key's own members remain where the service
 * declares no member of that name. Any other value is itself.
 */
export declare function $use<K extends Context.Key<any, any>>(
  key: K
): K extends Context.Key<infer I, infer S> ? Accessors<I, S> & Omit<K, keyof S> : K
export declare function $use<T>(value: T): T

/**
 * A call without arguments of a value that has no call signature (D90):
 * `Users()` projects to `$value(Users)()`. A function is itself; an Effect
 * value, such as a Context key or a Config, becomes a function that runs it.
 */
export declare function $value<F extends (...args: never[]) => unknown>(f: F): F
export declare function $value<E extends Cause.YieldableError>(error: E): () => EffectModule.Effect<never, E>
export declare function $value<A, E, R>(effect: EffectModule.Effect<A, E, R>): () => EffectModule.Effect<A, E, R>
export declare function $value<T>(value: T): T

/** D90 member calls retain their receiver when the member is a method. */
export declare function $member<T, K extends keyof T>(self: T, key: K):
  T[K] extends (...args: any[]) => any ? T[K] :
  T[K] extends Cause.YieldableError ? () => EffectModule.Effect<never, T[K]> :
  T[K] extends EffectModule.Effect<infer A, infer E, infer R> ? () => EffectModule.Effect<A, E, R> : T[K]

// ---------------------------------------------------------------- sentinel

/**
 * Whether T is the type of a name whose module did not resolve. Such a type
 * is TypeScript's error type, which passes for any other type, so the usual
 * `0 extends 1 & T` test gives the error type too; only an unwrapped
 * comparison against a type no real value has gives an answer.
 */
type Unresolved<T> = [T] extends [{ readonly "~vibelang-ts-mapper/unresolved": true }] ? true : false

/**
 * The first line of every projected file states `true satisfies $PreludeLoaded`.
 * When this module cannot resolve effect or vibelang-runtime from its own
 * location, every helper above is the error type, and skipLibCheck hides the
 * failed import; the statement then fails at line 1 of the .vibe file with
 * the fix (TS1360).
 */
export type $PreludeLoaded =
  Unresolved<typeof EffectModule.gen> extends true
    ? "vibelang-ts-mapper: the prelude cannot resolve effect from its own location; install effect 4.0.6 beside vibelang-ts-mapper"
    : Unresolved<typeof Runtime.$service> extends true
      ? "vibelang-ts-mapper: the prelude cannot resolve vibelang-runtime from its own location; install vibelang-runtime beside vibelang-ts-mapper"
      : true

// D169, D225: fiber forms share the runtime declarations in both renderings,
// and so does try p (VIP-5).
export { $join, $forConcurrent, $try } from "vibelang-runtime"

/** D49: stored collections convert parameterless Effect functions elementwise. */
type $ProgramOf<T> = T extends () => EffectModule.Effect<infer A, infer E, infer R> ? EffectModule.Effect<A, E, R> : T
export declare function $programs<T extends Iterable<unknown>>(values: T): Array<$ProgramOf<T extends Iterable<infer V> ? V : never>>
export declare function $programs<T extends Record<string, unknown>>(values: T): { [K in keyof T]: $ProgramOf<T[K]> }


// Separate composed-program yields before extracting E/R: TypeScript's
// generator inference must not discard an explicitly composed error subtype.
declare const $yieldSite: unique symbol
type $YieldAt<Id, E, R> = EffectModule.Effect<never, E, R> & { readonly [$yieldSite]: Id }
export declare function $runAt<A, E, R, const Id extends number>(value: EffectModule.Effect<A, E, R>, site: Id): Generator<$YieldAt<Id, E, R>, A, any>

/** Checker-only success witness for function-scoped variables crossing regions. */
export declare function $varType<A, E, R>(value: EffectModule.Effect<A, E, R>): A

/** S5-1/S22-3: only structured subtypes rejected by the declared success type reach this delegate. */
export declare function $returnRun<A, E, R>(value: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>

// BEGIN GENERATED D252 DATA METHODS
// Generated by cmd/vibelang-data-methods/generate.ts; do not edit.
import type * as $D152BigDecimal_Equal from "effect/Equal"
import type * as $D152BigDecimal_Equ from "effect/Equivalence"
import type { Inspectable as $D152BigDecimal_Inspectable } from "effect/Inspectable"
import type * as $D152BigDecimal_Option from "effect/Option"
import type * as $D152BigDecimal_order from "effect/Order"
import type { Ordering as $D152BigDecimal_Ordering } from "effect/Ordering"
import type { Pipeable as $D152BigDecimal_Pipeable } from "effect/Pipeable"
import type { BigDecimal as $D152BigDecimal_BigDecimal } from "effect/BigDecimal"
import type { RoundingMode as $D152BigDecimal_RoundingMode } from "effect/BigDecimal"
import type * as $D152Cause_Context from "effect/Context"
import type * as $D152Cause_Effect from "effect/Effect"
import type { Equal as $D152Cause_Equal } from "effect/Equal"
import type { Fiber as $D152Cause_Fiber } from "effect/Fiber"
import type { Inspectable as $D152Cause_Inspectable } from "effect/Inspectable"
import type { Option as $D152Cause_Option } from "effect/Option"
import type { Pipeable as $D152Cause_Pipeable } from "effect/Pipeable"
import type { StackFrame as $D152Cause_StackFrame } from "effect/References"
import type * as $D152Cause_Result from "effect/Result"
import type * as $D152Cause_Types from "effect/Types"
import type { Cause as $D152Cause_Cause } from "effect/Cause"
import type { Reason as $D152Cause_Reason } from "effect/Cause"
import type { Die as $D152Cause_Die } from "effect/Cause"
import type { Fail as $D152Cause_Fail } from "effect/Cause"
import type { Interrupt as $D152Cause_Interrupt } from "effect/Cause"
import type { YieldableError as $D152Cause_YieldableError } from "effect/Cause"
import type { NoSuchElementError as $D152Cause_NoSuchElementError } from "effect/Cause"
import type { Done as $D152Cause_Done } from "effect/Cause"
import type { TimeoutError as $D152Cause_TimeoutError } from "effect/Cause"
import type { IllegalArgumentError as $D152Cause_IllegalArgumentError } from "effect/Cause"
import type { ExceededCapacityError as $D152Cause_ExceededCapacityError } from "effect/Cause"
import type { AsyncFiberError as $D152Cause_AsyncFiberError } from "effect/Cause"
import type { UnknownError as $D152Cause_UnknownError } from "effect/Cause"
import type { StackTrace as $D152Cause_StackTrace } from "effect/Cause"
import type { InterruptorStackTrace as $D152Cause_InterruptorStackTrace } from "effect/Cause"
import type * as $D152Chunk_RA from "effect/Array"
import type { NonEmptyReadonlyArray as $D152Chunk_NonEmptyReadonlyArray } from "effect/Array"
import type * as $D152Chunk_Equal from "effect/Equal"
import type * as $D152Chunk_Equivalence from "effect/Equivalence"
import type * as $D152Chunk_Filter from "effect/Filter"
import type { TypeLambda as $D152Chunk_TypeLambda } from "effect/HKT"
import type { Inspectable as $D152Chunk_Inspectable } from "effect/Inspectable"
import type { NonEmptyIterable as $D152Chunk_NonEmptyIterable } from "effect/NonEmptyIterable"
import type { Option as $D152Chunk_Option } from "effect/Option"
import type * as $D152Chunk_O from "effect/Option"
import type * as $D152Chunk_Order from "effect/Order"
import type { Pipeable as $D152Chunk_Pipeable } from "effect/Pipeable"
import type { Predicate as $D152Chunk_Predicate } from "effect/Predicate"
import type { Refinement as $D152Chunk_Refinement } from "effect/Predicate"
import type { Result as $D152Chunk_Result } from "effect/Result"
import type { Covariant as $D152Chunk_Covariant } from "effect/Types"
import type { NoInfer as $D152Chunk_NoInfer } from "effect/Types"
import type { Chunk as $D152Chunk_Chunk } from "effect/Chunk"
import type { NonEmptyChunk as $D152Chunk_NonEmptyChunk } from "effect/Chunk"
import type { ChunkTypeLambda as $D152Chunk_ChunkTypeLambda } from "effect/Chunk"
import type { IllegalArgumentError as $D152DateTime_IllegalArgumentError } from "effect/Cause"
import type * as $D152DateTime_Context from "effect/Context"
import type * as $D152DateTime_Duration from "effect/Duration"
import type * as $D152DateTime_Effect from "effect/Effect"
import type * as $D152DateTime_Equ from "effect/Equivalence"
import type { LazyArg as $D152DateTime_LazyArg } from "effect/Function"
import type { Inspectable as $D152DateTime_Inspectable } from "effect/Inspectable"
import type * as $D152DateTime_Layer from "effect/Layer"
import type * as $D152DateTime_Option from "effect/Option"
import type * as $D152DateTime_order from "effect/Order"
import type { Pipeable as $D152DateTime_Pipeable } from "effect/Pipeable"
import type { DateTime as $D152DateTime_DateTime } from "effect/DateTime"
import type { Utc as $D152DateTime_Utc } from "effect/DateTime"
import type { Zoned as $D152DateTime_Zoned } from "effect/DateTime"
import type { TimeZone as $D152DateTime_TimeZone } from "effect/DateTime"
import type { Disambiguation as $D152DateTime_Disambiguation } from "effect/DateTime"
import type { CurrentTimeZone as $D152DateTime_CurrentTimeZone } from "effect/DateTime"
import type * as $D152Deferred_Cause from "effect/Cause"
import type { Effect as $D152Deferred_Effect } from "effect/Effect"
import type * as $D152Deferred_Exit from "effect/Exit"
import type { LazyArg as $D152Deferred_LazyArg } from "effect/Function"
import type * as $D152Deferred_Option from "effect/Option"
import type { Pipeable as $D152Deferred_Pipeable } from "effect/Pipeable"
import type * as $D152Deferred_Types from "effect/Types"
import type { Deferred as $D152Deferred_Deferred } from "effect/Deferred"
import type * as $D152Duration_Combiner from "effect/Combiner"
import type * as $D152Duration_Equal from "effect/Equal"
import type * as $D152Duration_Equ from "effect/Equivalence"
import type * as $D152Duration_Inspectable from "effect/Inspectable"
import type * as $D152Duration_Option from "effect/Option"
import type * as $D152Duration_order from "effect/Order"
import type { Pipeable as $D152Duration_Pipeable } from "effect/Pipeable"
import type * as $D152Duration_Reducer from "effect/Reducer"
import type { Duration as $D152Duration_Duration } from "effect/Duration"
import type { DurationValue as $D152Duration_DurationValue } from "effect/Duration"
import type { Unit as $D152Duration_Unit } from "effect/Duration"
import type { Input as $D152Duration_Input } from "effect/Duration"
import type { DurationObject as $D152Duration_DurationObject } from "effect/Duration"
import type * as $D152Effect_Arr from "effect/Array"
import type * as $D152Effect_Cause from "effect/Cause"
import type { Clock as $D152Effect_Clock } from "effect/Clock"
import type * as $D152Effect_Context from "effect/Context"
import type * as $D152Effect_Duration from "effect/Duration"
import type * as $D152Effect_ExecutionPlan from "effect/ExecutionPlan"
import type * as $D152Effect_Exit from "effect/Exit"
import type { Fiber as $D152Effect_Fiber } from "effect/Fiber"
import type * as $D152Effect_Filter from "effect/Filter"
import type { LazyArg as $D152Effect_LazyArg } from "effect/Function"
import type { TypeLambda as $D152Effect_TypeLambda } from "effect/HKT"
import type { Inspectable as $D152Effect_Inspectable } from "effect/Inspectable"
import type * as $D152Effect_Layer from "effect/Layer"
import type { Logger as $D152Effect_Logger } from "effect/Logger"
import type { Severity as $D152Effect_Severity } from "effect/LogLevel"
import type * as $D152Effect_Metric from "effect/Metric"
import type { Option as $D152Effect_Option } from "effect/Option"
import type { Pipeable as $D152Effect_Pipeable } from "effect/Pipeable"
import type * as $D152Effect_Predicate from "effect/Predicate"
import type * as $D152Effect_Request from "effect/Request"
import type { RequestResolver as $D152Effect_RequestResolver } from "effect/RequestResolver"
import type * as $D152Effect_Result from "effect/Result"
import type { Metadata as $D152Effect_ScheduleMetadata } from "effect/Schedule"
import type { Schedule as $D152Effect_Schedule } from "effect/Schedule"
import type { Scheduler as $D152Effect_Scheduler } from "effect/Scheduler"
import type { Scope as $D152Effect_Scope } from "effect/Scope"
import type { AnySpan as $D152Effect_AnySpan } from "effect/Tracer"
import type { ParentSpan as $D152Effect_ParentSpan } from "effect/Tracer"
import type { Span as $D152Effect_Span } from "effect/Tracer"
import type { SpanLink as $D152Effect_SpanLink } from "effect/Tracer"
import type { SpanOptions as $D152Effect_SpanOptions } from "effect/Tracer"
import type { SpanOptionsNoTrace as $D152Effect_SpanOptionsNoTrace } from "effect/Tracer"
import type { TraceOptions as $D152Effect_TraceOptions } from "effect/Tracer"
import type { Tracer as $D152Effect_Tracer } from "effect/Tracer"
import type { TxRef as $D152Effect_TxRef } from "effect/TxRef"
import type { Concurrency as $D152Effect_Concurrency } from "effect/Types"
import type { Covariant as $D152Effect_Covariant } from "effect/Types"
import type { EqualsWith as $D152Effect_EqualsWith } from "effect/Types"
import type { ExcludeReason as $D152Effect_ExcludeReason } from "effect/Types"
import type { ExcludeTag as $D152Effect_ExcludeTag } from "effect/Types"
import type { ExtractReason as $D152Effect_ExtractReason } from "effect/Types"
import type { ExtractTag as $D152Effect_ExtractTag } from "effect/Types"
import type { NarrowReason as $D152Effect_NarrowReason } from "effect/Types"
import type { NoInfer as $D152Effect_NoInfer } from "effect/Types"
import type { OmitReason as $D152Effect_OmitReason } from "effect/Types"
import type { ReasonOf as $D152Effect_ReasonOf } from "effect/Types"
import type { ReasonTags as $D152Effect_ReasonTags } from "effect/Types"
import type { Simplify as $D152Effect_Simplify } from "effect/Types"
import type { Tags as $D152Effect_Tags } from "effect/Types"
import type { unassigned as $D152Effect_unassigned } from "effect/Types"
import type * as $D152Effect_Unify from "effect/Unify"
import type { TypeId as $D152Effect_TypeId } from "effect/Effect"
import type { Effect as $D152Effect_Effect } from "effect/Effect"
import type { EffectUnify as $D152Effect_EffectUnify } from "effect/Effect"
import type { EffectTypeLambda as $D152Effect_EffectTypeLambda } from "effect/Effect"
import type { Variance as $D152Effect_Variance } from "effect/Effect"
import type { Success as $D152Effect_Success } from "effect/Effect"
import type { Error as $D152Effect_Error } from "effect/Effect"
import type { Services as $D152Effect_Services } from "effect/Effect"
import type { EffectIterator as $D152Effect_EffectIterator } from "effect/Effect"
import type { All as $D152Effect_All } from "effect/Effect"
import type { gen as $D152Effect_gen } from "effect/Effect"
import type { TagsWithReason as $D152Effect_TagsWithReason } from "effect/Effect"
import type { Retry as $D152Effect_Retry } from "effect/Effect"
import type { Repeat as $D152Effect_Repeat } from "effect/Effect"
import type { RunOptions as $D152Effect_RunOptions } from "effect/Effect"
import type { fn as $D152Effect_fn } from "effect/Effect"
import type { TransactionRetryReason as $D152Effect_TransactionRetryReason } from "effect/Effect"
import type { TransactionMeta as $D152Effect_TransactionMeta } from "effect/Effect"
import type { Transaction as $D152Effect_Transaction } from "effect/Effect"
import type { Effectify as $D152Effect_Effectify } from "effect/Effect"
import type * as $D152Exit_Cause from "effect/Cause"
import type * as $D152Exit_Effect from "effect/Effect"
import type { Option as $D152Exit_Option } from "effect/Option"
import type * as $D152Exit_Result from "effect/Result"
import type { NoInfer as $D152Exit_NoInfer } from "effect/Types"
import type { Exit as $D152Exit_Exit } from "effect/Exit"
import type { Success as $D152Exit_Success } from "effect/Exit"
import type { Failure as $D152Exit_Failure } from "effect/Exit"
import type * as $D152Fiber_Arr from "effect/Array"
import type * as $D152Fiber_Context from "effect/Context"
import type { Effect as $D152Fiber_Effect } from "effect/Effect"
import type { Exit as $D152Fiber_Exit } from "effect/Exit"
import type { LogLevel as $D152Fiber_LogLevel } from "effect/LogLevel"
import type { FiberRuntimeMetricsService as $D152Fiber_FiberRuntimeMetricsService } from "effect/Metric"
import type { Pipeable as $D152Fiber_Pipeable } from "effect/Pipeable"
import type { StackFrame as $D152Fiber_StackFrame } from "effect/References"
import type { Scheduler as $D152Fiber_Scheduler } from "effect/Scheduler"
import type { SchedulerDispatcher as $D152Fiber_SchedulerDispatcher } from "effect/Scheduler"
import type { Scope as $D152Fiber_Scope } from "effect/Scope"
import type { AnySpan as $D152Fiber_AnySpan } from "effect/Tracer"
import type { Tracer as $D152Fiber_Tracer } from "effect/Tracer"
import type { Covariant as $D152Fiber_Covariant } from "effect/Types"
import type { Fiber as $D152Fiber_Fiber } from "effect/Fiber"
import type { Equal as $D152HashMap_Equal } from "effect/Equal"
import type { Inspectable as $D152HashMap_Inspectable } from "effect/Inspectable"
import type { Option as $D152HashMap_Option } from "effect/Option"
import type { Pipeable as $D152HashMap_Pipeable } from "effect/Pipeable"
import type { Result as $D152HashMap_Result } from "effect/Result"
import type { NoInfer as $D152HashMap_NoInfer } from "effect/Types"
import type { HashMap as $D152HashMap_HashMap } from "effect/HashMap"
import type { Equal as $D152HashSet_Equal } from "effect/Equal"
import type { Inspectable as $D152HashSet_Inspectable } from "effect/Inspectable"
import type { Pipeable as $D152HashSet_Pipeable } from "effect/Pipeable"
import type { Predicate as $D152HashSet_Predicate } from "effect/Predicate"
import type { Refinement as $D152HashSet_Refinement } from "effect/Predicate"
import type { NoInfer as $D152HashSet_NoInfer } from "effect/Types"
import type { HashSet as $D152HashSet_HashSet } from "effect/HashSet"
import type * as $D152Option_Combiner from "effect/Combiner"
import type * as $D152Option_Equivalence from "effect/Equivalence"
import type * as $D152Option_Filter from "effect/Filter"
import type { LazyArg as $D152Option_LazyArg } from "effect/Function"
import type { TypeLambda as $D152Option_TypeLambda } from "effect/HKT"
import type { Inspectable as $D152Option_Inspectable } from "effect/Inspectable"
import type { Order as $D152Option_Order } from "effect/Order"
import type { Pipeable as $D152Option_Pipeable } from "effect/Pipeable"
import type { Predicate as $D152Option_Predicate } from "effect/Predicate"
import type { Refinement as $D152Option_Refinement } from "effect/Predicate"
import type * as $D152Option_Reducer from "effect/Reducer"
import type { Result as $D152Option_Result } from "effect/Result"
import type { Covariant as $D152Option_Covariant } from "effect/Types"
import type { NoInfer as $D152Option_NoInfer } from "effect/Types"
import type { NotFunction as $D152Option_NotFunction } from "effect/Types"
import type * as $D152Option_Unify from "effect/Unify"
import type * as $D152Option_Gen from "effect/Utils"
import type { Option as $D152Option_Option } from "effect/Option"
import type { None as $D152Option_None } from "effect/Option"
import type { OptionIterator as $D152Option_OptionIterator } from "effect/Option"
import type { Some as $D152Option_Some } from "effect/Option"
import type { OptionUnify as $D152Option_OptionUnify } from "effect/Option"
import type { OptionUnifyIgnore as $D152Option_OptionUnifyIgnore } from "effect/Option"
import type { OptionTypeLambda as $D152Option_OptionTypeLambda } from "effect/Option"
import type * as $D152Queue_Arr from "effect/Array"
import type { Cause as $D152Queue_Cause } from "effect/Cause"
import type { Done as $D152Queue_Done } from "effect/Cause"
import type { Effect as $D152Queue_Effect } from "effect/Effect"
import type { Exit as $D152Queue_Exit } from "effect/Exit"
import type { Failure as $D152Queue_Failure } from "effect/Exit"
import type { Inspectable as $D152Queue_Inspectable } from "effect/Inspectable"
import type * as $D152Queue_MutableList from "effect/MutableList"
import type * as $D152Queue_Option from "effect/Option"
import type * as $D152Queue_Pull from "effect/Pull"
import type { SchedulerDispatcher as $D152Queue_SchedulerDispatcher } from "effect/Scheduler"
import type * as $D152Queue_Types from "effect/Types"
import type { Enqueue as $D152Queue_Enqueue } from "effect/Queue"
import type { Dequeue as $D152Queue_Dequeue } from "effect/Queue"
import type { Queue as $D152Queue_Queue } from "effect/Queue"
import type * as $D152Ref_Effect from "effect/Effect"
import type * as $D152Ref_MutableRef from "effect/MutableRef"
import type * as $D152Ref_Option from "effect/Option"
import type { Pipeable as $D152Ref_Pipeable } from "effect/Pipeable"
import type { Invariant as $D152Ref_Invariant } from "effect/Types"
import type { Ref as $D152Ref_Ref } from "effect/Ref"
import type * as $D152Result_Equivalence from "effect/Equivalence"
import type { LazyArg as $D152Result_LazyArg } from "effect/Function"
import type { TypeLambda as $D152Result_TypeLambda } from "effect/HKT"
import type { Inspectable as $D152Result_Inspectable } from "effect/Inspectable"
import type { Option as $D152Result_Option } from "effect/Option"
import type { Pipeable as $D152Result_Pipeable } from "effect/Pipeable"
import type { Predicate as $D152Result_Predicate } from "effect/Predicate"
import type { Refinement as $D152Result_Refinement } from "effect/Predicate"
import type { Covariant as $D152Result_Covariant } from "effect/Types"
import type { NoInfer as $D152Result_NoInfer } from "effect/Types"
import type { NotFunction as $D152Result_NotFunction } from "effect/Types"
import type * as $D152Result_Unify from "effect/Unify"
import type * as $D152Result_Gen from "effect/Utils"
import type { Result as $D152Result_Result } from "effect/Result"
import type { Failure as $D152Result_Failure } from "effect/Result"
import type { ResultIterator as $D152Result_ResultIterator } from "effect/Result"
import type { Success as $D152Result_Success } from "effect/Result"
import type { ResultUnify as $D152Result_ResultUnify } from "effect/Result"
import type { ResultUnifyIgnore as $D152Result_ResultUnifyIgnore } from "effect/Result"
import type { ResultTypeLambda as $D152Result_ResultTypeLambda } from "effect/Result"
import type { NonEmptyReadonlyArray as $D152Schedule_NonEmptyReadonlyArray } from "effect/Array"
import type * as $D152Schedule_Context from "effect/Context"
import type * as $D152Schedule_Cron from "effect/Cron"
import type * as $D152Schedule_DateTime from "effect/DateTime"
import type * as $D152Schedule_Duration from "effect/Duration"
import type { Effect as $D152Schedule_Effect } from "effect/Effect"
import type { Pipeable as $D152Schedule_Pipeable } from "effect/Pipeable"
import type * as $D152Schedule_Pull from "effect/Pull"
import type * as $D152Schedule_Result from "effect/Result"
import type { Contravariant as $D152Schedule_Contravariant } from "effect/Types"
import type { Covariant as $D152Schedule_Covariant } from "effect/Types"
import type { UnionToIntersection as $D152Schedule_UnionToIntersection } from "effect/Types"
import type { Schedule as $D152Schedule_Schedule } from "effect/Schedule"
import type { InputMetadata as $D152Schedule_InputMetadata } from "effect/Schedule"
import type { Metadata as $D152Schedule_Metadata } from "effect/Schedule"
import type { Output as $D152Schedule_Output } from "effect/Schedule"
import type { Input as $D152Schedule_Input } from "effect/Schedule"
import type { Error as $D152Schedule_Error } from "effect/Schedule"
import type { Env as $D152Schedule_Env } from "effect/Schedule"
import type { NonEmptyReadonlyArray as $D152Sink_NonEmptyReadonlyArray } from "effect/Array"
import type * as $D152Sink_Arr from "effect/Array"
import type * as $D152Sink_Cause from "effect/Cause"
import type * as $D152Sink_Channel from "effect/Channel"
import type * as $D152Sink_Context from "effect/Context"
import type * as $D152Sink_Duration from "effect/Duration"
import type * as $D152Sink_Effect from "effect/Effect"
import type * as $D152Sink_Exit from "effect/Exit"
import type * as $D152Sink_Filter from "effect/Filter"
import type { LazyArg as $D152Sink_LazyArg } from "effect/Function"
import type * as $D152Sink_Option from "effect/Option"
import type { Pipeable as $D152Sink_Pipeable } from "effect/Pipeable"
import type { Predicate as $D152Sink_Predicate } from "effect/Predicate"
import type { Refinement as $D152Sink_Refinement } from "effect/Predicate"
import type * as $D152Sink_PubSub from "effect/PubSub"
import type * as $D152Sink_Pull from "effect/Pull"
import type * as $D152Sink_Queue from "effect/Queue"
import type * as $D152Sink_Scope from "effect/Scope"
import type { Stream as $D152Sink_Stream } from "effect/Stream"
import type * as $D152Sink_Types from "effect/Types"
import type * as $D152Sink_Unify from "effect/Unify"
import type { Sink as $D152Sink_Sink } from "effect/Sink"
import type { End as $D152Sink_End } from "effect/Sink"
import type { SinkUnify as $D152Sink_SinkUnify } from "effect/Sink"
import type { SinkUnifyIgnore as $D152Sink_SinkUnifyIgnore } from "effect/Sink"
import type { make as $D152Sink_make } from "effect/Sink"
import type * as $D152Stream_Arr from "effect/Array"
import type * as $D152Stream_ByteSize from "effect/ByteSize"
import type * as $D152Stream_Cause from "effect/Cause"
import type * as $D152Stream_Channel from "effect/Channel"
import type * as $D152Stream_Context from "effect/Context"
import type * as $D152Stream_Duration from "effect/Duration"
import type * as $D152Stream_Effect from "effect/Effect"
import type * as $D152Stream_ExecutionPlan from "effect/ExecutionPlan"
import type * as $D152Stream_Exit from "effect/Exit"
import type * as $D152Stream_Filter from "effect/Filter"
import type { LazyArg as $D152Stream_LazyArg } from "effect/Function"
import type { TypeLambda as $D152Stream_TypeLambda } from "effect/HKT"
import type * as $D152Stream_Layer from "effect/Layer"
import type { Severity as $D152Stream_Severity } from "effect/LogLevel"
import type * as $D152Stream_Option from "effect/Option"
import type { Pipeable as $D152Stream_Pipeable } from "effect/Pipeable"
import type { Predicate as $D152Stream_Predicate } from "effect/Predicate"
import type { Refinement as $D152Stream_Refinement } from "effect/Predicate"
import type * as $D152Stream_PubSub from "effect/PubSub"
import type * as $D152Stream_Pull from "effect/Pull"
import type * as $D152Stream_Queue from "effect/Queue"
import type * as $D152Stream_Result from "effect/Result"
import type * as $D152Stream_Schedule from "effect/Schedule"
import type * as $D152Stream_Scope from "effect/Scope"
import type * as $D152Stream_Sink from "effect/Sink"
import type * as $D152Stream_Take from "effect/Take"
import type { ParentSpan as $D152Stream_ParentSpan } from "effect/Tracer"
import type { SpanOptions as $D152Stream_SpanOptions } from "effect/Tracer"
import type { Concurrency as $D152Stream_Concurrency } from "effect/Types"
import type { Covariant as $D152Stream_Covariant } from "effect/Types"
import type { ExcludeReason as $D152Stream_ExcludeReason } from "effect/Types"
import type { ExcludeTag as $D152Stream_ExcludeTag } from "effect/Types"
import type { ExtractReason as $D152Stream_ExtractReason } from "effect/Types"
import type { ExtractTag as $D152Stream_ExtractTag } from "effect/Types"
import type { NarrowReason as $D152Stream_NarrowReason } from "effect/Types"
import type { NoInfer as $D152Stream_NoInfer } from "effect/Types"
import type { OmitReason as $D152Stream_OmitReason } from "effect/Types"
import type { ReasonOf as $D152Stream_ReasonOf } from "effect/Types"
import type { ReasonTags as $D152Stream_ReasonTags } from "effect/Types"
import type { Simplify as $D152Stream_Simplify } from "effect/Types"
import type { Tags as $D152Stream_Tags } from "effect/Types"
import type { TupleOf as $D152Stream_TupleOf } from "effect/Types"
import type { unassigned as $D152Stream_unassigned } from "effect/Types"
import type * as $D152Stream_Unify from "effect/Unify"
import type { TypeId as $D152Stream_TypeId } from "effect/Stream"
import type { Stream as $D152Stream_Stream } from "effect/Stream"
import type { StreamUnify as $D152Stream_StreamUnify } from "effect/Stream"
import type { StreamUnifyIgnore as $D152Stream_StreamUnifyIgnore } from "effect/Stream"
import type { StreamTypeLambda as $D152Stream_StreamTypeLambda } from "effect/Stream"
import type { Variance as $D152Stream_Variance } from "effect/Stream"
import type { VarianceStruct as $D152Stream_VarianceStruct } from "effect/Stream"
import type { Success as $D152Stream_Success } from "effect/Stream"
import type { Error as $D152Stream_Error } from "effect/Stream"
import type { Services as $D152Stream_Services } from "effect/Stream"
import type { HaltStrategy as $D152Stream_HaltStrategy } from "effect/Stream"
import type { EventListener as $D152Stream_EventListener } from "effect/Stream"

type $D152EffectReceiver = { readonly "~effect/BigDecimal"?: never; readonly "~effect/Cause"?: never; readonly "~effect/Cause/Reason"?: never; readonly "~effect/Cause/NoSuchElementError"?: never; readonly "~effect/Cause/Done"?: never; readonly "~effect/Cause/TimeoutError"?: never; readonly "~effect/Cause/IllegalArgumentError"?: never; readonly "~effect/Cause/ExceededCapacityError"?: never; readonly "~effect/Cause/AsyncFiberError"?: never; readonly "~effect/Cause/UnknownError"?: never; readonly "~effect/Chunk"?: never; readonly "~effect/DateTime"?: never; readonly "~effect/DateTime/TimeZone"?: never; readonly "~effect/Deferred"?: never; readonly "~effect/Duration"?: never; readonly "~effect/Exit"?: never; readonly "~effect/Fiber"?: never; readonly "~effect/HashMap"?: never; readonly "~effect/HashSet"?: never; readonly "~effect/Option"?: never; readonly "~effect/Queue"?: never; readonly "~effect/Queue/Enqueue"?: never; readonly "~effect/Queue/Dequeue"?: never; readonly "~effect/Ref"?: never; readonly "~effect/Result"?: never; readonly "~effect/Schedule"?: never; readonly "~effect/Sink"?: never; readonly "~effect/Stream"?: never };
type $D152BigDecimalModels = import("effect/BigDecimal").BigDecimal;
type $D152CauseModels = import("effect/Cause").Cause<any> | import("effect/Cause").Die | import("effect/Cause").Fail<any> | import("effect/Cause").Interrupt | import("effect/Cause").NoSuchElementError | import("effect/Cause").Done<any> | import("effect/Cause").TimeoutError | import("effect/Cause").IllegalArgumentError | import("effect/Cause").ExceededCapacityError | import("effect/Cause").AsyncFiberError | import("effect/Cause").UnknownError;
type $D152ChunkModels = import("effect/Chunk").Chunk<any> | import("effect/Chunk").NonEmptyChunk<any>;
type $D152DateTimeModels = import("effect/DateTime").Utc | import("effect/DateTime").Zoned | import("effect/DateTime").TimeZone.Offset | import("effect/DateTime").TimeZone.Named;
type $D152DeferredModels = import("effect/Deferred").Deferred<any, any>;
type $D152DurationModels = import("effect/Duration").Duration;
type $D152EffectModels = import("effect/Effect").Effect<any, any, any>;
type $D152ExitModels = import("effect/Exit").Success<any, any> | import("effect/Exit").Failure<any, any>;
type $D152FiberModels = import("effect/Fiber").Fiber<any, any>;
type $D152HashMapModels = import("effect/HashMap").HashMap<any, any>;
type $D152HashSetModels = import("effect/HashSet").HashSet<any>;
type $D152OptionModels = import("effect/Option").None<any> | import("effect/Option").Some<any>;
type $D152QueueModels = import("effect/Queue").Enqueue<any, any> | import("effect/Queue").Dequeue<any, any> | import("effect/Queue").Queue<any, any>;
type $D152RefModels = import("effect/Ref").Ref<any>;
type $D152ResultModels = import("effect/Result").Failure<any, any> | import("effect/Result").Success<any, any>;
type $D152ScheduleModels = import("effect/Schedule").Schedule<any, any, any, any>;
type $D152SinkModels = import("effect/Sink").Sink<any, any, any, any, any>;
type $D152StreamModels = import("effect/Stream").Stream<any, any, any>;
export declare function $dataGuard(value: unknown & $D152CauseModels, name: "isCause", args: [], result: boolean): value is $D152Cause_Cause<unknown>;
export declare function $dataGuard(value: unknown & $D152CauseModels, name: "isReason", args: [], result: boolean): value is $D152Cause_Reason<unknown>;
export declare function $dataGuard<E>(value: $D152Cause_Reason<E> & $D152CauseModels, name: "isFailReason", args: [], result: boolean): value is $D152Cause_Fail<E>;
export declare function $dataGuard<E>(value: $D152Cause_Reason<E> & $D152CauseModels, name: "isDieReason", args: [], result: boolean): value is $D152Cause_Die;
export declare function $dataGuard<E>(value: $D152Cause_Reason<E> & $D152CauseModels, name: "isInterruptReason", args: [], result: boolean): value is $D152Cause_Interrupt;
export declare function $dataGuard<A>(value: $D152Chunk_Chunk<A> & $D152ChunkModels, name: "isNonEmpty", args: [], result: boolean): value is $D152Chunk_NonEmptyChunk<A>;
export declare function $dataGuard<A, B extends A>(value: $D152Chunk_Chunk<A> & $D152ChunkModels, name: "every", args: [refinement: $D152Chunk_Refinement<A, B>], result: boolean): value is $D152Chunk_Chunk<B>;
export declare function $dataGuard<A>(value: $D152Chunk_Chunk<A> & $D152ChunkModels, name: "some", args: [predicate: $D152Chunk_Predicate<A>], result: boolean): value is $D152Chunk_NonEmptyChunk<A>;
export declare function $dataGuard(value: $D152DateTime_DateTime & $D152DateTimeModels, name: "isUtc", args: [], result: boolean): value is $D152DateTime_Utc;
export declare function $dataGuard(value: $D152DateTime_DateTime & $D152DateTimeModels, name: "isZoned", args: [], result: boolean): value is $D152DateTime_Zoned;
export declare function $dataGuard<A, E>(value: $D152Exit_Exit<A, E> & $D152ExitModels, name: "isSuccess", args: [], result: boolean): value is $D152Exit_Success<A, E>;
export declare function $dataGuard<A, E>(value: $D152Exit_Exit<A, E> & $D152ExitModels, name: "isFailure", args: [], result: boolean): value is $D152Exit_Failure<A, E>;
export declare function $dataGuard<A, E>(value: $D152Exit_Exit<A, E> & $D152ExitModels, name: "hasFails", args: [], result: boolean): value is $D152Exit_Failure<A, E>;
export declare function $dataGuard<A, E>(value: $D152Exit_Exit<A, E> & $D152ExitModels, name: "hasDies", args: [], result: boolean): value is $D152Exit_Failure<A, E>;
export declare function $dataGuard<A, E>(value: $D152Exit_Exit<A, E> & $D152ExitModels, name: "hasInterrupts", args: [], result: boolean): value is $D152Exit_Failure<A, E>;
export declare function $dataGuard<A>(value: $D152Option_Option<A> & $D152OptionModels, name: "isNone", args: [], result: boolean): value is $D152Option_None<A>;
export declare function $dataGuard<A>(value: $D152Option_Option<A> & $D152OptionModels, name: "isSome", args: [], result: boolean): value is $D152Option_Some<A>;
export declare function $dataGuard<A, B extends A>(value: $D152Option_Option<A> & $D152OptionModels, name: "exists", args: [refinement: $D152Option_Refinement<A, B>], result: boolean): value is $D152Option_Option<B>;
export declare function $dataGuard<A, E>(value: $D152Result_Result<A, E> & $D152ResultModels, name: "isFailure", args: [], result: boolean): value is $D152Result_Failure<A, E>;
export declare function $dataGuard<A, E>(value: $D152Result_Result<A, E> & $D152ResultModels, name: "isSuccess", args: [], result: boolean): value is $D152Result_Success<A, E>;
export declare function $dataGuard<V, K extends keyof V, R>(value: V, name: K, args: V[K] extends (...args: infer Args) => unknown ? Args : never, result: R): R;

interface $D152Method_normalize {
    "normalize"(this: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
}
interface $D152Method_sum {
    "sum"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
    "sum"(this: $D152Duration_Duration, that: $D152Duration_Duration): $D152Duration_Duration;
}
interface $D152Method_multiply {
    "multiply"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
}
interface $D152Method_subtract {
    "subtract"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
    "subtract"<A extends $D152DateTime_DateTime>(this: A, parts: Partial<$D152DateTime_DateTime.PartsForMath>): A;
    "subtract"(this: $D152Duration_Duration, that: $D152Duration_Duration): $D152Duration_Duration;
}
interface $D152Method_divide {
    "divide"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): $D152BigDecimal_Option.Option<$D152BigDecimal_BigDecimal>;
    "divide"(this: $D152Duration_Duration, by: number): $D152Duration_Option.Option<$D152Duration_Duration>;
}
interface $D152Method_divideUnsafe {
    "divideUnsafe"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
    "divideUnsafe"(this: $D152Duration_Duration, by: number): $D152Duration_Duration;
}
interface $D152Method_isLessThan {
    "isLessThan"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): boolean;
    "isLessThan"(this: $D152DateTime_DateTime, that: $D152DateTime_DateTime): boolean;
    "isLessThan"(this: $D152Duration_Duration, that: $D152Duration_Duration): boolean;
}
interface $D152Method_isLessThanOrEqualTo {
    "isLessThanOrEqualTo"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): boolean;
    "isLessThanOrEqualTo"(this: $D152DateTime_DateTime, that: $D152DateTime_DateTime): boolean;
    "isLessThanOrEqualTo"(this: $D152Duration_Duration, that: $D152Duration_Duration): boolean;
}
interface $D152Method_isGreaterThan {
    "isGreaterThan"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): boolean;
    "isGreaterThan"(this: $D152DateTime_DateTime, that: $D152DateTime_DateTime): boolean;
    "isGreaterThan"(this: $D152Duration_Duration, that: $D152Duration_Duration): boolean;
}
interface $D152Method_isGreaterThanOrEqualTo {
    "isGreaterThanOrEqualTo"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): boolean;
    "isGreaterThanOrEqualTo"(this: $D152DateTime_DateTime, that: $D152DateTime_DateTime): boolean;
    "isGreaterThanOrEqualTo"(this: $D152Duration_Duration, that: $D152Duration_Duration): boolean;
}
interface $D152Method_between {
    "between"(this: $D152BigDecimal_BigDecimal, options: {
    minimum: $D152BigDecimal_BigDecimal;
    maximum: $D152BigDecimal_BigDecimal;
}): boolean;
    "between"(this: $D152DateTime_DateTime, options: {
    minimum: $D152DateTime_DateTime;
    maximum: $D152DateTime_DateTime;
}): boolean;
    "between"(this: $D152Duration_Duration, options: {
    minimum: $D152Duration_Duration;
    maximum: $D152Duration_Duration;
}): boolean;
}
interface $D152Method_clamp {
    "clamp"(this: $D152BigDecimal_BigDecimal, options: {
    minimum: $D152BigDecimal_BigDecimal;
    maximum: $D152BigDecimal_BigDecimal;
}): $D152BigDecimal_BigDecimal;
    "clamp"<A extends $D152DateTime_DateTime, Min extends $D152DateTime_DateTime, Max extends $D152DateTime_DateTime>(this: A, options: {
    readonly minimum: Min;
    readonly maximum: Max;
}): A | Min | Max;
    "clamp"(this: $D152Duration_Duration, options: {
    minimum: $D152Duration_Duration;
    maximum: $D152Duration_Duration;
}): $D152Duration_Duration;
}
interface $D152Method_min {
    "min"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
    "min"<Self extends $D152DateTime_DateTime, That extends $D152DateTime_DateTime>(this: Self, that: That): Self | That;
    "min"(this: $D152Duration_Duration, that: $D152Duration_Duration): $D152Duration_Duration;
}
interface $D152Method_max {
    "max"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
    "max"<Self extends $D152DateTime_DateTime, That extends $D152DateTime_DateTime>(this: Self, that: That): Self | That;
    "max"(this: $D152Duration_Duration, that: $D152Duration_Duration): $D152Duration_Duration;
}
interface $D152Method_sign {
    "sign"(this: $D152BigDecimal_BigDecimal): $D152BigDecimal_Ordering;
}
interface $D152Method_abs {
    "abs"(this: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
    "abs"(this: $D152Duration_Duration): $D152Duration_Duration;
}
interface $D152Method_negate {
    "negate"(this: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
    "negate"(this: $D152Duration_Duration): $D152Duration_Duration;
}
interface $D152Method_remainder {
    "remainder"(this: $D152BigDecimal_BigDecimal, divisor: $D152BigDecimal_BigDecimal): $D152BigDecimal_Option.Option<$D152BigDecimal_BigDecimal>;
}
interface $D152Method_remainderUnsafe {
    "remainderUnsafe"(this: $D152BigDecimal_BigDecimal, divisor: $D152BigDecimal_BigDecimal): $D152BigDecimal_BigDecimal;
}
interface $D152Method_equals {
    "equals"(this: $D152BigDecimal_BigDecimal, that: $D152BigDecimal_BigDecimal): boolean;
    "equals"(this: $D152Duration_Duration, that: $D152Duration_Duration): boolean;
}
interface $D152Method_format {
    "format"(this: $D152BigDecimal_BigDecimal): string;
    "format"(this: $D152DateTime_DateTime, options?: (Intl.DateTimeFormatOptions & {
    readonly locale?: string | undefined;
}) | undefined): string;
    "format"(this: $D152Duration_Duration): string;
}
interface $D152Method_toExponential {
    "toExponential"(this: $D152BigDecimal_BigDecimal): string;
}
interface $D152Method_toNumberUnsafe {
    "toNumberUnsafe"(this: $D152BigDecimal_BigDecimal): number;
}
interface $D152Method_isInteger {
    "isInteger"(this: $D152BigDecimal_BigDecimal): boolean;
}
interface $D152Method_isZero {
    "isZero"(this: $D152BigDecimal_BigDecimal): boolean;
    "isZero"(this: $D152Duration_Duration): boolean;
}
interface $D152Method_isNegative {
    "isNegative"(this: $D152BigDecimal_BigDecimal): boolean;
    "isNegative"(this: $D152Duration_Duration): boolean;
}
interface $D152Method_isPositive {
    "isPositive"(this: $D152BigDecimal_BigDecimal): boolean;
    "isPositive"(this: $D152Duration_Duration): boolean;
}
interface $D152Method_round {
    "round"(this: $D152BigDecimal_BigDecimal, options?: {
    scale?: number;
    mode?: $D152BigDecimal_RoundingMode;
}): $D152BigDecimal_BigDecimal;
}
interface $D152Method_truncate {
    "truncate"(this: $D152BigDecimal_BigDecimal, scale?: number): $D152BigDecimal_BigDecimal;
}
interface $D152Method_ceil {
    "ceil"(this: $D152BigDecimal_BigDecimal, scale?: number): $D152BigDecimal_BigDecimal;
}
interface $D152Method_floor {
    "floor"(this: $D152BigDecimal_BigDecimal, scale?: number): $D152BigDecimal_BigDecimal;
}
interface $D152Method_isCause {
    "isCause"(this: unknown): this is $D152Cause_Cause<unknown>;
}
interface $D152Method_isReason {
    "isReason"(this: unknown): this is $D152Cause_Reason<unknown>;
}
interface $D152Method_isFailReason {
    "isFailReason"<E>(this: $D152Cause_Reason<E>): this is $D152Cause_Fail<E>;
}
interface $D152Method_isDieReason {
    "isDieReason"<E>(this: $D152Cause_Reason<E>): this is $D152Cause_Die;
}
interface $D152Method_isInterruptReason {
    "isInterruptReason"<E>(this: $D152Cause_Reason<E>): this is $D152Cause_Interrupt;
}
interface $D152Method_hasInterruptsOnly {
    "hasInterruptsOnly"<E>(this: $D152Cause_Cause<E>): boolean;
}
interface $D152Method_map {
    "map"<E, E2>(this: $D152Cause_Cause<E>, f: (error: $D152Cause_Types.NoInfer<E>) => E2): $D152Cause_Cause<E2>;
    "map"<A, B>(this: $D152Chunk_NonEmptyChunk<A>, f: (a: A, i: number) => B): $D152Chunk_NonEmptyChunk<B>;
    "map"<A, B>(this: $D152Chunk_Chunk<A>, f: (a: A, i: number) => B): $D152Chunk_Chunk<B>;
    "map"<A, E, B>(this: $D152Exit_Exit<A, E>, f: (a: A) => B): $D152Exit_Exit<B, E>;
    "map"<K, V, A>(this: $D152HashMap_HashMap<K, V>, f: (value: V, key: K) => A): $D152HashMap_HashMap<K, A>;
    "map"<V, U>(this: $D152HashSet_HashSet<V>, f: (value: V) => U): $D152HashSet_HashSet<U>;
    "map"<A, B>(this: $D152Option_Option<A>, f: (a: A) => B): $D152Option_Option<B>;
    "map"<A, E, A2>(this: $D152Result_Result<A, E>, f: (ok: A) => A2): $D152Result_Result<A2, E>;
    "map"<Output, Input, Error, Env, Output2, Error2 = never, Env2 = never>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, f: (metadata: $D152Schedule_Metadata<Output, Input>) => Output2 | $D152Schedule_Effect<Output2, Error2, Env2>): $D152Schedule_Schedule<Output2, Input, Error | Error2, Env | Env2>;
    "map"<A, In, L, E, R, A2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (a: A) => A2): $D152Sink_Sink<A2, In, L, E, R>;
    "map"<A, E, R, B>(this: $D152Stream_Stream<A, E, R>, f: (a: A, i: number) => B): $D152Stream_Stream<B, E, R>;
    "map"<A, E, R, B>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (a: A) => B): $D152Effect_Effect<B, E, R>;
}
interface $D152Method_combine {
    "combine"<E, E2>(this: $D152Cause_Cause<E>, that: $D152Cause_Cause<E2>): $D152Cause_Cause<E | E2>;
    "combine"<A, E, R, A2, E2, R2, S, A3, E3, R3>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>, s: $D152Stream_LazyArg<S>, f: (s: S, pullLeft: $D152Stream_Pull.Pull<A, E, void>, pullRight: $D152Stream_Pull.Pull<A2, E2, void>) => $D152Stream_Effect.Effect<readonly [
    A3,
    S
], E3, R3>): $D152Stream_Stream<A3, E3, R | R2 | R3>;
}
interface $D152Method_squash {
    "squash"<E>(this: $D152Cause_Cause<E>): unknown;
}
interface $D152Method_hasFails {
    "hasFails"<E>(this: $D152Cause_Cause<E>): boolean;
    "hasFails"<A, E>(this: $D152Exit_Exit<A, E>): this is $D152Exit_Failure<A, E>;
}
interface $D152Method_findFail {
    "findFail"<E>(this: $D152Cause_Cause<E>): $D152Cause_Result.Result<$D152Cause_Fail<E>, $D152Cause_Cause<never>>;
}
interface $D152Method_findError {
    "findError"<E>(this: $D152Cause_Cause<E>): $D152Cause_Result.Result<E, $D152Cause_Cause<never>>;
    "findError"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Result.Result<E, $D152Exit_Exit<A, E>>;
}
interface $D152Method_findErrorOption {
    "findErrorOption"<E>(this: $D152Cause_Cause<E>): $D152Cause_Option<E>;
    "findErrorOption"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Option<E>;
}
interface $D152Method_hasDies {
    "hasDies"<E>(this: $D152Cause_Cause<E>): boolean;
    "hasDies"<A, E>(this: $D152Exit_Exit<A, E>): this is $D152Exit_Failure<A, E>;
}
interface $D152Method_findDie {
    "findDie"<E>(this: $D152Cause_Cause<E>): $D152Cause_Result.Result<$D152Cause_Die, $D152Cause_Cause<E>>;
}
interface $D152Method_findDefect {
    "findDefect"<E>(this: $D152Cause_Cause<E>): $D152Cause_Result.Result<unknown, $D152Cause_Cause<E>>;
    "findDefect"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Result.Result<unknown, $D152Exit_Exit<A, E>>;
}
interface $D152Method_hasInterrupts {
    "hasInterrupts"<E>(this: $D152Cause_Cause<E>): boolean;
    "hasInterrupts"<A, E>(this: $D152Exit_Exit<A, E>): this is $D152Exit_Failure<A, E>;
}
interface $D152Method_findInterrupt {
    "findInterrupt"<E>(this: $D152Cause_Cause<E>): $D152Cause_Result.Result<$D152Cause_Interrupt, $D152Cause_Cause<E>>;
}
interface $D152Method_interruptors {
    "interruptors"<E>(this: $D152Cause_Cause<E>): ReadonlySet<number>;
}
interface $D152Method_filterInterruptors {
    "filterInterruptors"<E>(this: $D152Cause_Cause<E>): $D152Cause_Result.Result<Set<number>, $D152Cause_Cause<E>>;
}
interface $D152Method_prettyErrors {
    "prettyErrors"<E>(this: $D152Cause_Cause<E>, options?: {
    readonly includeCauseInStack?: boolean | undefined;
}): Array<Error>;
}
interface $D152Method_pretty {
    "pretty"<E>(this: $D152Cause_Cause<E>): string;
}
interface $D152Method_reasonAnnotations {
    "reasonAnnotations"<E>(this: $D152Cause_Reason<E>): $D152Cause_Context.Context<never>;
}
interface $D152Method_fromIterable {
    "fromIterable"<A>(this: Iterable<A>): $D152Chunk_Chunk<A>;
}
interface $D152Method_toArray {
    "toArray"<S extends $D152Chunk_Chunk<any>>(this: S): S extends $D152Chunk_NonEmptyChunk<any> ? $D152Chunk_RA.NonEmptyArray<$D152Chunk_Chunk.Infer<S>> : Array<$D152Chunk_Chunk.Infer<S>>;
    "toArray"<A>(this: $D152Option_Option<A>): Array<A>;
}
interface $D152Method_toReadonlyArray {
    "toReadonlyArray"<S extends $D152Chunk_Chunk<any>>(this: S): S extends $D152Chunk_NonEmptyChunk<any> ? $D152Chunk_RA.NonEmptyReadonlyArray<$D152Chunk_Chunk.Infer<S>> : ReadonlyArray<$D152Chunk_Chunk.Infer<S>>;
}
interface $D152Method_reverse {
    "reverse"<S extends $D152Chunk_Chunk<any>>(this: S): $D152Chunk_Chunk.With<S, $D152Chunk_Chunk.Infer<S>>;
}
interface $D152Method_get {
    "get"<A>(this: $D152Chunk_Chunk<A>, index: number): $D152Chunk_Option<A>;
    "get"<K1 extends K, K, V>(this: $D152HashMap_HashMap<K, V>, key: K1): $D152HashMap_Option<V>;
    "get"<A>(this: $D152Ref_Ref<A>): $D152Ref_Effect.Effect<A, never, never>;
}
interface $D152Method_fromArrayUnsafe {
    "fromArrayUnsafe"<A>(this: ReadonlyArray<A>): $D152Chunk_Chunk<A>;
}
interface $D152Method_fromNonEmptyArrayUnsafe {
    "fromNonEmptyArrayUnsafe"<A>(this: $D152Chunk_NonEmptyReadonlyArray<A>): $D152Chunk_NonEmptyChunk<A>;
}
interface $D152Method_getUnsafe {
    "getUnsafe"<A>(this: $D152Chunk_Chunk<A>, index: number): A;
    "getUnsafe"<K1 extends K, K, V>(this: $D152HashMap_HashMap<K, V>, key: K1): V;
    "getUnsafe"<A>(this: $D152Ref_Ref<A>): A;
}
interface $D152Method_append {
    "append"<A, A2>(this: $D152Chunk_Chunk<A>, a: A2): $D152Chunk_NonEmptyChunk<A | A2>;
}
interface $D152Method_prepend {
    "prepend"<A, B>(this: $D152Chunk_Chunk<A>, elem: B): $D152Chunk_NonEmptyChunk<A | B>;
    "prepend"<A, E, R, B>(this: $D152Stream_Stream<A, E, R>, values: Iterable<B>): $D152Stream_Stream<A | B, E, R>;
}
interface $D152Method_take {
    "take"<A>(this: $D152Chunk_Chunk<A>, n: number): $D152Chunk_Chunk<A>;
    "take"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Effect<A, E>;
    "take"<A, E, R>(this: $D152Stream_Stream<A, E, R>, n: number): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_drop {
    "drop"<A>(this: $D152Chunk_Chunk<A>, n: number): $D152Chunk_Chunk<A>;
    "drop"<A, E, R>(this: $D152Stream_Stream<A, E, R>, n: number): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_dropRight {
    "dropRight"<A>(this: $D152Chunk_Chunk<A>, n: number): $D152Chunk_Chunk<A>;
    "dropRight"<A, E, R>(this: $D152Stream_Stream<A, E, R>, n: number): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_dropWhile {
    "dropWhile"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): $D152Chunk_Chunk<A>;
    "dropWhile"<A, E, R>(this: $D152Stream_Stream<A, E, R>, predicate: (a: $D152Stream_NoInfer<A>, index: number) => boolean): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_prependAll {
    "prependAll"<A, B>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_NonEmptyChunk<B>): $D152Chunk_NonEmptyChunk<A | B>;
    "prependAll"<A, B>(this: $D152Chunk_NonEmptyChunk<A>, that: $D152Chunk_Chunk<B>): $D152Chunk_NonEmptyChunk<A | B>;
    "prependAll"<A, B>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_Chunk<B>): $D152Chunk_Chunk<A | B>;
}
interface $D152Method_appendAll {
    "appendAll"<A, B>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_NonEmptyChunk<B>): $D152Chunk_NonEmptyChunk<A | B>;
    "appendAll"<A, B>(this: $D152Chunk_NonEmptyChunk<A>, that: $D152Chunk_Chunk<B>): $D152Chunk_NonEmptyChunk<A | B>;
    "appendAll"<A, B>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_Chunk<B>): $D152Chunk_Chunk<A | B>;
}
interface $D152Method_filterMap {
    "filterMap"<A, B, X>(this: $D152Chunk_Chunk<A>, f: (input: A, i: number) => $D152Chunk_Result<B, X>): $D152Chunk_Chunk<B>;
    "filterMap"<K, A, B, X>(this: $D152HashMap_HashMap<K, A>, f: (input: A, key: K) => $D152HashMap_Result<B, X>): $D152HashMap_HashMap<K, B>;
    "filterMap"<A, B, X>(this: $D152Option_Option<A>, f: $D152Option_Filter.Filter<A, B, X>): $D152Option_Option<B>;
    "filterMap"<A, E, R, B, X>(this: $D152Stream_Stream<A, E, R>, filter: $D152Stream_Filter.Filter<A, B, X>): $D152Stream_Stream<B, E, R>;
}
interface $D152Method_filter {
    "filter"<A, B extends A>(this: $D152Chunk_Chunk<A>, refinement: $D152Chunk_Refinement<A, B>): $D152Chunk_Chunk<B>;
    "filter"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): $D152Chunk_Chunk<A>;
    "filter"<K, A>(this: $D152HashMap_HashMap<K, A>, f: (a: A, k: K) => boolean): $D152HashMap_HashMap<K, A>;
    "filter"<V, U extends V>(this: $D152HashSet_HashSet<V>, refinement: $D152HashSet_Refinement<V, U>): $D152HashSet_HashSet<U>;
    "filter"<V>(this: $D152HashSet_HashSet<V>, predicate: $D152HashSet_Predicate<V>): $D152HashSet_HashSet<V>;
    "filter"<A, B extends A>(this: $D152Option_Option<A>, refinement: $D152Option_Refinement<A, B>): $D152Option_Option<B>;
    "filter"<A>(this: $D152Option_Option<A>, predicate: $D152Option_Predicate<A>): $D152Option_Option<A>;
    "filter"<A, E, R, B extends A>(this: $D152Stream_Stream<A, E, R>, refinement: $D152Stream_Refinement<A, B>): $D152Stream_Stream<B, E, R>;
    "filter"<A, E, R>(this: $D152Stream_Stream<A, E, R>, predicate: $D152Stream_Predicate<A>): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_filterMapWhile {
    "filterMapWhile"<A, B, X>(this: $D152Chunk_Chunk<A>, f: $D152Chunk_Filter.Filter<A, B, X>): $D152Chunk_Chunk<B>;
}
interface $D152Method_compact {
    "compact"<A>(this: $D152Chunk_Chunk<$D152Chunk_Option<A>>): $D152Chunk_Chunk<A>;
    "compact"<K, A>(this: $D152HashMap_HashMap<K, $D152HashMap_Option<A>>): $D152HashMap_HashMap<K, A>;
}
interface $D152Method_flatMap {
    "flatMap"<A, B>(this: $D152Chunk_NonEmptyChunk<A>, f: (a: A, i: number) => $D152Chunk_NonEmptyChunk<B>): $D152Chunk_NonEmptyChunk<B>;
    "flatMap"<A, B>(this: $D152Chunk_Chunk<A>, f: (a: A, i: number) => $D152Chunk_Chunk<B>): $D152Chunk_Chunk<B>;
    "flatMap"<K, A, B>(this: $D152HashMap_HashMap<K, A>, f: (value: A, key: K) => $D152HashMap_HashMap<K, B>): $D152HashMap_HashMap<K, B>;
    "flatMap"<A, B>(this: $D152Option_Option<A>, f: (a: A) => $D152Option_Option<B>): $D152Option_Option<B>;
    "flatMap"<A, E, A2, E2>(this: $D152Result_Result<A, E>, f: (a: A) => $D152Result_Result<A2, E2>): $D152Result_Result<A2, E | E2>;
    "flatMap"<A, In, L, E, R, A1, In1 extends L, L1, E1, R1>(this: $D152Sink_Sink<A, In, L, E, R>, f: (a: A) => $D152Sink_Sink<A1, In1, L1, E1, R1>): $D152Sink_Sink<A1, In & In1, L | L1, E | E1, R | R1>;
    "flatMap"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: A) => $D152Stream_Stream<A2, E2, R2>, options?: {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly bufferSize?: number | undefined;
} | undefined): $D152Stream_Stream<A2, E | E2, R | R2>;
    "flatMap"<A, E, R, B, E1, R1>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (a: A) => $D152Effect_Effect<B, E1, R1>): $D152Effect_Effect<B, E | E1, R | R1>;
}
interface $D152Method_forEach {
    "forEach"<A, B>(this: $D152Chunk_Chunk<A>, f: (a: A, index: number) => B): void;
    "forEach"<V, K>(this: $D152HashMap_HashMap<K, V>, f: (value: V, key: K) => void): void;
    "forEach"<B, E, R, S extends Iterable<any>, const Discard extends boolean = false>(this: (S) & $D152EffectReceiver, f: (a: $D152Effect_Arr.ReadonlyArray.Infer<S>, i: number) => $D152Effect_Effect<B, E, R>, options?: {
    readonly concurrency?: $D152Effect_Concurrency | undefined;
    readonly discard?: Discard | undefined;
} | undefined): $D152Effect_Effect<Discard extends false ? $D152Effect_Arr.ReadonlyArray.With<S, B> : void, E, R>;
}
interface $D152Method_flatten {
    "flatten"<S extends $D152Chunk_Chunk<$D152Chunk_Chunk<any>>>(this: S): $D152Chunk_Chunk.Flatten<S>;
    "flatten"<A>(this: $D152Option_Option<$D152Option_Option<A>>): $D152Option_Option<A>;
    "flatten"<Arg extends $D152Stream_Stream<$D152Stream_Stream<any, any, any>, any, any> | {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly bufferSize?: number | undefined;
} | undefined = {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly bufferSize?: number | undefined;
}>(this: Arg, options?: {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly bufferSize?: number | undefined;
} | undefined): [
    Arg
] extends [
    $D152Stream_Stream<$D152Stream_Stream<infer _A, infer _E, infer _R>, infer _E2, infer _R2>
] ? $D152Stream_Stream<_A, _E | _E2, _R | _R2> : <A, E, R, E2, R2>(self: $D152Stream_Stream<$D152Stream_Stream<A, E, R>, E2, R2>) => $D152Stream_Stream<A, E | E2, R | R2>;
    "flatten"<A, E, R, E2, R2>(this: ($D152Effect_Effect<$D152Effect_Effect<A, E, R>, E2, R2>) & $D152EffectReceiver): $D152Effect_Effect<A, E | E2, R | R2>;
}
interface $D152Method_chunksOf {
    "chunksOf"<A>(this: $D152Chunk_Chunk<A>, n: number): $D152Chunk_Chunk<$D152Chunk_Chunk<A>>;
}
interface $D152Method_intersection {
    "intersection"<A, B>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_Chunk<B>): $D152Chunk_Chunk<A & B>;
    "intersection"<V0, V1>(this: $D152HashSet_HashSet<V0>, that: $D152HashSet_HashSet<V1>): $D152HashSet_HashSet<V0 & V1>;
}
interface $D152Method_isEmpty {
    "isEmpty"<A>(this: $D152Chunk_Chunk<A>): boolean;
    "isEmpty"<K, V>(this: $D152HashMap_HashMap<K, V>): boolean;
    "isEmpty"<V>(this: $D152HashSet_HashSet<V>): boolean;
}
interface $D152Method_isNonEmpty {
    "isNonEmpty"<A>(this: $D152Chunk_Chunk<A>): this is $D152Chunk_NonEmptyChunk<A>;
}
interface $D152Method_head {
    "head"<A>(this: $D152Chunk_Chunk<A>): $D152Chunk_Option<A>;
    "head"<A, E, R>(this: ($D152Effect_Effect<Iterable<A>, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, E | $D152Effect_Cause.NoSuchElementError, R>;
}
interface $D152Method_headUnsafe {
    "headUnsafe"<A>(this: $D152Chunk_Chunk<A>): A;
}
interface $D152Method_headNonEmpty {
    "headNonEmpty"<A>(this: $D152Chunk_NonEmptyChunk<A>): A;
}
interface $D152Method_last {
    "last"<A>(this: $D152Chunk_Chunk<A>): $D152Chunk_Option<A>;
}
interface $D152Method_lastUnsafe {
    "lastUnsafe"<A>(this: $D152Chunk_Chunk<A>): A;
}
interface $D152Method_lastNonEmpty {
    "lastNonEmpty"<A>(this: $D152Chunk_NonEmptyChunk<A>): A;
}
interface $D152Method_mapAccum {
    "mapAccum"<S, A, B>(this: $D152Chunk_Chunk<A>, s: S, f: (s: S, a: A) => readonly [
    S,
    B
]): [
    S,
    $D152Chunk_Chunk<B>
];
    "mapAccum"<A, E, R, S, B>(this: $D152Stream_Stream<A, E, R>, initial: $D152Stream_LazyArg<S>, f: (s: S, a: A) => readonly [
    state: S,
    values: ReadonlyArray<B>
], options?: {
    readonly onHalt?: ((state: S) => ReadonlyArray<B>) | undefined;
}): $D152Stream_Stream<B, E, R>;
}
interface $D152Method_partition {
    "partition"<A, Pass, Fail>(this: $D152Chunk_Chunk<A>, f: (input: A, i: number) => $D152Chunk_Result<Pass, Fail>): [
    passes: $D152Chunk_Chunk<Pass>,
    fails: $D152Chunk_Chunk<Fail>
];
    "partition"<A, E, R, Pass, Fail>(this: $D152Stream_Stream<A, E, R>, filter: $D152Stream_Filter.Filter<$D152Stream_NoInfer<A>, Pass, Fail>, options?: {
    readonly capacity?: number | "unbounded" | undefined;
}): $D152Stream_Effect.Effect<[
    passes: $D152Stream_Stream<Pass, E>,
    fails: $D152Stream_Stream<Fail, E>
], never, R | $D152Stream_Scope.Scope>;
}
interface $D152Method_separate {
    "separate"<A, B>(this: $D152Chunk_Chunk<$D152Chunk_Result<B, A>>): [
    $D152Chunk_Chunk<B>,
    $D152Chunk_Chunk<A>
];
}
interface $D152Method_size {
    "size"<A>(this: $D152Chunk_Chunk<A>): number;
    "size"<K, V>(this: $D152HashMap_HashMap<K, V>): number;
    "size"<V>(this: $D152HashSet_HashSet<V>): number;
    "size"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Effect<number>;
}
interface $D152Method_sort {
    "sort"<A extends B, B>(this: $D152Chunk_Chunk<A>, $D152Chunk_O: $D152Chunk_Order.Order<B>): $D152Chunk_Chunk<A>;
}
interface $D152Method_sortWith {
    "sortWith"<A, B>(this: $D152Chunk_Chunk<A>, f: (a: A) => B, order: $D152Chunk_Order.Order<B>): $D152Chunk_Chunk<A>;
}
interface $D152Method_splitAt {
    "splitAt"<A>(this: $D152Chunk_Chunk<A>, n: number): [
    beforeIndex: $D152Chunk_Chunk<A>,
    fromIndex: $D152Chunk_Chunk<A>
];
}
interface $D152Method_splitNonEmptyAt {
    "splitNonEmptyAt"<A>(this: $D152Chunk_NonEmptyChunk<A>, n: number): [
    beforeIndex: $D152Chunk_NonEmptyChunk<A>,
    fromIndex: $D152Chunk_Chunk<A>
];
}
interface $D152Method_split {
    "split"<A>(this: $D152Chunk_Chunk<A>, n: number): $D152Chunk_Chunk<$D152Chunk_Chunk<A>>;
    "split"<A, E, R, B extends A>(this: $D152Stream_Stream<A, E, R>, refinement: $D152Stream_Refinement<A, B>): $D152Stream_Stream<$D152Stream_Arr.NonEmptyReadonlyArray<Exclude<A, B>>, E, R>;
    "split"<A, E, R>(this: $D152Stream_Stream<A, E, R>, predicate: $D152Stream_Predicate<A>): $D152Stream_Stream<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, R>;
}
interface $D152Method_splitWhere {
    "splitWhere"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): [
    beforeMatch: $D152Chunk_Chunk<A>,
    fromMatch: $D152Chunk_Chunk<A>
];
}
interface $D152Method_tail {
    "tail"<A>(this: $D152Chunk_Chunk<A>): $D152Chunk_O.Option<$D152Chunk_Chunk<A>>;
}
interface $D152Method_tailNonEmpty {
    "tailNonEmpty"<A>(this: $D152Chunk_NonEmptyChunk<A>): $D152Chunk_Chunk<A>;
}
interface $D152Method_takeRight {
    "takeRight"<A>(this: $D152Chunk_Chunk<A>, n: number): $D152Chunk_Chunk<A>;
    "takeRight"<A, E, R>(this: $D152Stream_Stream<A, E, R>, n: number): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_takeWhile {
    "takeWhile"<A, B extends A>(this: $D152Chunk_Chunk<A>, refinement: $D152Chunk_Refinement<A, B>): $D152Chunk_Chunk<B>;
    "takeWhile"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): $D152Chunk_Chunk<A>;
    "takeWhile"<A, E, R, B extends A>(this: $D152Stream_Stream<A, E, R>, refinement: (a: $D152Stream_NoInfer<A>, n: number) => a is B): $D152Stream_Stream<B, E, R>;
    "takeWhile"<A, E, R>(this: $D152Stream_Stream<A, E, R>, predicate: (a: $D152Stream_NoInfer<A>, n: number) => boolean): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_union {
    "union"<A, B>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_Chunk<B>): $D152Chunk_Chunk<A | B>;
    "union"<K0, V0, K1, V1>(this: $D152HashMap_HashMap<K0, V0>, that: $D152HashMap_HashMap<K1, V1>): $D152HashMap_HashMap<K0 | K1, V0 | V1>;
    "union"<V0, V1>(this: $D152HashSet_HashSet<V0>, that: $D152HashSet_HashSet<V1>): $D152HashSet_HashSet<V0 | V1>;
}
interface $D152Method_dedupe {
    "dedupe"<A>(this: $D152Chunk_Chunk<A>): $D152Chunk_Chunk<A>;
}
interface $D152Method_dedupeAdjacent {
    "dedupeAdjacent"<A>(this: $D152Chunk_Chunk<A>): $D152Chunk_Chunk<A>;
}
interface $D152Method_unzip {
    "unzip"<A, B>(this: $D152Chunk_Chunk<readonly [
    A,
    B
]>): [
    $D152Chunk_Chunk<A>,
    $D152Chunk_Chunk<B>
];
}
interface $D152Method_zipWith {
    "zipWith"<A, B, C>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_Chunk<B>, f: (a: A, b: B) => C): $D152Chunk_Chunk<C>;
    "zipWith"<A, B, C>(this: $D152Option_Option<A>, that: $D152Option_Option<B>, f: (a: A, b: B) => C): $D152Option_Option<C>;
    "zipWith"<AL, EL, RL, AR, ER, RR, A>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>, f: (left: AL, right: AR) => A): $D152Stream_Stream<A, EL | ER, RL | RR>;
    "zipWith"<A, E, R, A2, E2, R2, B>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, that: $D152Effect_Effect<A2, E2, R2>, f: (a: A, b: A2) => B, options?: {
    readonly concurrent?: boolean | undefined;
}): $D152Effect_Effect<B, E2 | E, R2 | R>;
}
interface $D152Method_zip {
    "zip"<A, B>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_Chunk<B>): $D152Chunk_Chunk<[
    A,
    B
]>;
    "zip"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<[
    A,
    A2
], E | E2, R | R2>;
    "zip"<A, E, R, A2, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, that: $D152Effect_Effect<A2, E2, R2>, options?: {
    readonly concurrent?: boolean | undefined;
}): $D152Effect_Effect<[
    A,
    A2
], E | E2, R | R2>;
}
interface $D152Method_remove {
    "remove"<A>(this: $D152Chunk_Chunk<A>, i: number): $D152Chunk_Chunk<A>;
    "remove"<K, V>(this: $D152HashMap_HashMap<K, V>, key: K): $D152HashMap_HashMap<K, V>;
    "remove"<V>(this: $D152HashSet_HashSet<V>, value: V): $D152HashSet_HashSet<V>;
}
interface $D152Method_modify {
    "modify"<A, B>(this: $D152Chunk_Chunk<A>, i: number, f: (a: A) => B): $D152Chunk_O.Option<$D152Chunk_Chunk<A | B>>;
    "modify"<K, V>(this: $D152HashMap_HashMap<K, V>, key: K, f: (v: V) => V): $D152HashMap_HashMap<K, V>;
    "modify"<A, B>(this: $D152Ref_Ref<A>, f: (a: A) => readonly [
    B,
    A
]): $D152Ref_Effect.Effect<B>;
}
interface $D152Method_replace {
    "replace"<A, B>(this: $D152Chunk_Chunk<A>, i: number, b: B): $D152Chunk_O.Option<$D152Chunk_Chunk<B | A>>;
}
interface $D152Method_contains {
    "contains"<A>(this: $D152Chunk_Chunk<A>, a: A): boolean;
    "contains"<A>(this: $D152Option_Option<A>, a: A): boolean;
}
interface $D152Method_findFirst {
    "findFirst"<A, B extends A>(this: $D152Chunk_Chunk<A>, refinement: $D152Chunk_Refinement<A, B>): $D152Chunk_Option<B>;
    "findFirst"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): $D152Chunk_Option<A>;
    "findFirst"<K, A>(this: $D152HashMap_HashMap<K, A>, predicate: (a: A, k: K) => boolean): $D152HashMap_Option<[
    K,
    A
]>;
}
interface $D152Method_findFirstIndex {
    "findFirstIndex"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): $D152Chunk_O.Option<number>;
}
interface $D152Method_findLast {
    "findLast"<A, B extends A>(this: $D152Chunk_Chunk<A>, refinement: $D152Chunk_Refinement<A, B>): $D152Chunk_Option<B>;
    "findLast"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): $D152Chunk_Option<A>;
}
interface $D152Method_findLastIndex {
    "findLastIndex"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): $D152Chunk_O.Option<number>;
}
interface $D152Method_every {
    "every"<A, B extends A>(this: $D152Chunk_Chunk<A>, refinement: $D152Chunk_Refinement<A, B>): this is $D152Chunk_Chunk<B>;
    "every"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): boolean;
    "every"<K, A>(this: $D152HashMap_HashMap<K, A>, predicate: (a: A, k: K) => boolean): boolean;
    "every"<V>(this: $D152HashSet_HashSet<V>, predicate: $D152HashSet_Predicate<V>): boolean;
}
interface $D152Method_some {
    "some"<A>(this: $D152Chunk_Chunk<A>, predicate: $D152Chunk_Predicate<A>): this is $D152Chunk_NonEmptyChunk<A>;
    "some"<K, A>(this: $D152HashMap_HashMap<K, A>, predicate: (a: A, k: K) => boolean): boolean;
    "some"<V>(this: $D152HashSet_HashSet<V>, predicate: $D152HashSet_Predicate<V>): boolean;
}
interface $D152Method_join {
    "join"(this: $D152Chunk_Chunk<string>, sep: string): string;
    "join"<A, E>(this: $D152Fiber_Fiber<A, E>): $D152Fiber_Effect<A, E>;
}
interface $D152Method_reduce {
    "reduce"<A, B>(this: $D152Chunk_Chunk<A>, b: B, f: (b: B, a: A, i: number) => B): B;
    "reduce"<K, V, Z>(this: $D152HashMap_HashMap<K, V>, zero: Z, f: (accumulator: Z, value: V, key: K) => Z): Z;
    "reduce"<V, U>(this: $D152HashSet_HashSet<V>, zero: U, f: (accumulator: U, value: V) => U): U;
}
interface $D152Method_reduceRight {
    "reduceRight"<A, B>(this: $D152Chunk_Chunk<A>, b: B, f: (b: B, a: A, i: number) => B): B;
}
interface $D152Method_difference {
    "difference"<A>(this: $D152Chunk_Chunk<A>, that: $D152Chunk_Chunk<A>): $D152Chunk_Chunk<A>;
    "difference"<V0, V1>(this: $D152HashSet_HashSet<V0>, that: $D152HashSet_HashSet<V1>): $D152HashSet_HashSet<V0>;
}
interface $D152Method_isUtc {
    "isUtc"(this: $D152DateTime_DateTime): this is $D152DateTime_Utc;
}
interface $D152Method_isZoned {
    "isZoned"(this: $D152DateTime_DateTime): this is $D152DateTime_Zoned;
}
interface $D152Method_toUtc {
    "toUtc"(this: $D152DateTime_DateTime): $D152DateTime_Utc;
}
interface $D152Method_setZone {
    "setZone"(this: $D152DateTime_DateTime, zone: $D152DateTime_TimeZone, options?: {
    readonly adjustForTimeZone?: boolean | undefined;
    readonly disambiguation?: $D152DateTime_Disambiguation | undefined;
}): $D152DateTime_Zoned;
}
interface $D152Method_setZoneOffset {
    "setZoneOffset"(this: $D152DateTime_DateTime, offset: number, options?: {
    readonly adjustForTimeZone?: boolean | undefined;
    readonly disambiguation?: $D152DateTime_Disambiguation | undefined;
}): $D152DateTime_Zoned;
}
interface $D152Method_zoneToString {
    "zoneToString"(this: $D152DateTime_TimeZone): string;
}
interface $D152Method_setZoneNamed {
    "setZoneNamed"(this: $D152DateTime_DateTime, zoneId: string, options?: {
    readonly adjustForTimeZone?: boolean | undefined;
    readonly disambiguation?: $D152DateTime_Disambiguation | undefined;
}): $D152DateTime_Option.Option<$D152DateTime_Zoned>;
}
interface $D152Method_setZoneNamedUnsafe {
    "setZoneNamedUnsafe"(this: $D152DateTime_DateTime, zoneId: string, options?: {
    readonly adjustForTimeZone?: boolean | undefined;
    readonly disambiguation?: $D152DateTime_Disambiguation | undefined;
}): $D152DateTime_Zoned;
}
interface $D152Method_distance {
    "distance"(this: $D152DateTime_DateTime, other: $D152DateTime_DateTime): $D152DateTime_Duration.Duration;
}
interface $D152Method_isFuture {
    "isFuture"(this: $D152DateTime_DateTime): $D152DateTime_Effect.Effect<boolean>;
}
interface $D152Method_isFutureUnsafe {
    "isFutureUnsafe"(this: $D152DateTime_DateTime): boolean;
}
interface $D152Method_isPast {
    "isPast"(this: $D152DateTime_DateTime): $D152DateTime_Effect.Effect<boolean>;
}
interface $D152Method_isPastUnsafe {
    "isPastUnsafe"(this: $D152DateTime_DateTime): boolean;
}
interface $D152Method_toDateUtc {
    "toDateUtc"(this: $D152DateTime_DateTime): Date;
}
interface $D152Method_toDate {
    "toDate"(this: $D152DateTime_DateTime): Date;
}
interface $D152Method_zonedOffset {
    "zonedOffset"(this: $D152DateTime_Zoned): number;
}
interface $D152Method_zonedOffsetIso {
    "zonedOffsetIso"(this: $D152DateTime_Zoned): string;
}
interface $D152Method_toEpochMillis {
    "toEpochMillis"(this: $D152DateTime_DateTime): number;
}
interface $D152Method_toEpochSeconds {
    "toEpochSeconds"(this: $D152DateTime_DateTime): number;
}
interface $D152Method_removeTime {
    "removeTime"(this: $D152DateTime_DateTime): $D152DateTime_Utc;
}
interface $D152Method_toParts {
    "toParts"(this: $D152DateTime_DateTime): $D152DateTime_DateTime.PartsWithWeekday;
}
interface $D152Method_toPartsUtc {
    "toPartsUtc"(this: $D152DateTime_DateTime): $D152DateTime_DateTime.PartsWithWeekday;
}
interface $D152Method_getPartUtc {
    "getPartUtc"(this: $D152DateTime_DateTime, part: keyof $D152DateTime_DateTime.PartsWithWeekday): number;
}
interface $D152Method_getPart {
    "getPart"(this: $D152DateTime_DateTime, part: keyof $D152DateTime_DateTime.PartsWithWeekday): number;
}
interface $D152Method_setParts {
    "setParts"<A extends $D152DateTime_DateTime>(this: A, parts: Partial<$D152DateTime_DateTime.PartsWithWeekday>): A;
}
interface $D152Method_setPartsUtc {
    "setPartsUtc"<A extends $D152DateTime_DateTime>(this: A, parts: Partial<$D152DateTime_DateTime.PartsWithWeekday>): A;
}
interface $D152Method_setZoneCurrent {
    "setZoneCurrent"(this: $D152DateTime_DateTime): $D152DateTime_Effect.Effect<$D152DateTime_Zoned, never, $D152DateTime_CurrentTimeZone>;
}
interface $D152Method_withCurrentZone {
    "withCurrentZone"<A, E, R>(this: $D152DateTime_Effect.Effect<A, E, R>, value: $D152DateTime_TimeZone): $D152DateTime_Effect.Effect<A, E, Exclude<R, $D152DateTime_CurrentTimeZone>>;
}
interface $D152Method_mutate {
    "mutate"<A extends $D152DateTime_DateTime>(this: A, f: (date: Date) => void, options?: {
    readonly disambiguation?: $D152DateTime_Disambiguation | undefined;
}): A;
    "mutate"<K, V>(this: $D152HashMap_HashMap<K, V>, f: (self: $D152HashMap_HashMap<K, V>) => void): $D152HashMap_HashMap<K, V>;
}
interface $D152Method_mutateUtc {
    "mutateUtc"<A extends $D152DateTime_DateTime>(this: A, f: (date: Date) => void): A;
}
interface $D152Method_mapEpochMillis {
    "mapEpochMillis"<A extends $D152DateTime_DateTime>(this: A, f: (millis: number) => number): A;
}
interface $D152Method_withDate {
    "withDate"<A>(this: $D152DateTime_DateTime, f: (date: Date) => A): A;
}
interface $D152Method_withDateUtc {
    "withDateUtc"<A>(this: $D152DateTime_DateTime, f: (date: Date) => A): A;
}
interface $D152Method_match {
    "match"<A, B>(this: $D152DateTime_DateTime, options: {
    readonly onUtc: (_: $D152DateTime_Utc) => A;
    readonly onZoned: (_: $D152DateTime_Zoned) => B;
}): A | B;
    "match"<A, B, C, D = C>(this: $D152Duration_Duration, options: {
    readonly onMillis: (millis: number) => A;
    readonly onNanos: (nanos: bigint) => B;
    readonly onInfinity: () => C;
    readonly onNegativeInfinity?: () => D;
}): A | B | C | D;
    "match"<A, E, X1, X2>(this: $D152Exit_Exit<A, E>, options: {
    readonly onSuccess: (a: A) => X1;
    readonly onFailure: (cause: $D152Exit_Cause.Cause<E>) => X2;
}): X1 | X2;
    "match"<A, B, C = B>(this: $D152Option_Option<A>, options: {
    readonly onNone: $D152Option_LazyArg<B>;
    readonly onSome: (a: A) => C;
}): B | C;
    "match"<A, E, B, C = B>(this: $D152Result_Result<A, E>, options: {
    readonly onFailure: (error: E) => B;
    readonly onSuccess: (ok: A) => C;
}): B | C;
    "match"<A, E, R, A2, A3>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (error: E) => A2;
    readonly onSuccess: (value: A) => A3;
}): $D152Effect_Effect<A2 | A3, never, R>;
}
interface $D152Method_addDuration {
    "addDuration"<A extends $D152DateTime_DateTime>(this: A, duration: $D152DateTime_Duration.Input): A;
}
interface $D152Method_subtractDuration {
    "subtractDuration"<A extends $D152DateTime_DateTime>(this: A, duration: $D152DateTime_Duration.Input): A;
}
interface $D152Method_add {
    "add"<A extends $D152DateTime_DateTime>(this: A, parts: Partial<$D152DateTime_DateTime.PartsForMath>): A;
    "add"<V>(this: $D152HashSet_HashSet<V>, value: V): $D152HashSet_HashSet<V>;
}
interface $D152Method_startOf {
    "startOf"<A extends $D152DateTime_DateTime>(this: A, part: $D152DateTime_DateTime.UnitSingular, options?: {
    readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined;
}): A;
}
interface $D152Method_endOf {
    "endOf"<A extends $D152DateTime_DateTime>(this: A, part: $D152DateTime_DateTime.UnitSingular, options?: {
    readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined;
}): A;
}
interface $D152Method_nearest {
    "nearest"<A extends $D152DateTime_DateTime>(this: A, part: $D152DateTime_DateTime.UnitSingular, options?: {
    readonly weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined;
}): A;
}
interface $D152Method_formatLocal {
    "formatLocal"(this: $D152DateTime_DateTime, options?: (Intl.DateTimeFormatOptions & {
    readonly locale?: string | undefined;
}) | undefined): string;
}
interface $D152Method_formatUtc {
    "formatUtc"(this: $D152DateTime_DateTime, options?: (Intl.DateTimeFormatOptions & {
    readonly locale?: string | undefined;
}) | undefined): string;
}
interface $D152Method_formatIntl {
    "formatIntl"(this: $D152DateTime_DateTime, format: Intl.DateTimeFormat): string;
}
interface $D152Method_formatIso {
    "formatIso"(this: $D152DateTime_DateTime): string;
}
interface $D152Method_formatIsoDate {
    "formatIsoDate"(this: $D152DateTime_DateTime): string;
}
interface $D152Method_formatIsoDateUtc {
    "formatIsoDateUtc"(this: $D152DateTime_DateTime): string;
}
interface $D152Method_formatIsoOffset {
    "formatIsoOffset"(this: $D152DateTime_DateTime): string;
}
interface $D152Method_formatIsoZoned {
    "formatIsoZoned"(this: $D152DateTime_Zoned): string;
}
interface $D152Method_complete {
    "complete"<A, E, R>(this: $D152Deferred_Deferred<A, E>, effect: $D152Deferred_Effect<A, E, R>): $D152Deferred_Effect<boolean, never, R>;
}
interface $D152Method_completeWith {
    "completeWith"<A, E>(this: $D152Deferred_Deferred<A, E>, effect: $D152Deferred_Effect<A, E>): $D152Deferred_Effect<boolean>;
}
interface $D152Method_done {
    "done"<A, E>(this: $D152Deferred_Deferred<A, E>, exit: $D152Deferred_Exit.Exit<A, E>): $D152Deferred_Effect<boolean>;
}
interface $D152Method_fail {
    "fail"<A, E>(this: $D152Deferred_Deferred<A, E>, error: E): $D152Deferred_Effect<boolean>;
    "fail"<A, E>(this: $D152Queue_Enqueue<A, E>, error: E): $D152Queue_Effect<boolean>;
}
interface $D152Method_failSync {
    "failSync"<A, E>(this: $D152Deferred_Deferred<A, E>, evaluate: $D152Deferred_LazyArg<E>): $D152Deferred_Effect<boolean>;
}
interface $D152Method_failCause {
    "failCause"<A, E>(this: $D152Deferred_Deferred<A, E>, cause: $D152Deferred_Cause.Cause<E>): $D152Deferred_Effect<boolean>;
    "failCause"<A, E>(this: $D152Queue_Enqueue<A, E>, cause: $D152Queue_Cause<E>): $D152Queue_Effect<boolean>;
}
interface $D152Method_failCauseSync {
    "failCauseSync"<A, E>(this: $D152Deferred_Deferred<A, E>, evaluate: $D152Deferred_LazyArg<$D152Deferred_Cause.Cause<E>>): $D152Deferred_Effect<boolean>;
}
interface $D152Method_die {
    "die"<A, E>(this: $D152Deferred_Deferred<A, E>, defect: unknown): $D152Deferred_Effect<boolean>;
}
interface $D152Method_dieSync {
    "dieSync"<A, E>(this: $D152Deferred_Deferred<A, E>, evaluate: $D152Deferred_LazyArg<unknown>): $D152Deferred_Effect<boolean>;
}
interface $D152Method_interrupt {
    "interrupt"<A, E>(this: $D152Deferred_Deferred<A, E>): $D152Deferred_Effect<boolean>;
    "interrupt"<A, E>(this: $D152Fiber_Fiber<A, E>): $D152Fiber_Effect<void>;
    "interrupt"<A, E>(this: $D152Queue_Enqueue<A, E>): $D152Queue_Effect<boolean>;
}
interface $D152Method_interruptWith {
    "interruptWith"<A, E>(this: $D152Deferred_Deferred<A, E>, fiberId: number): $D152Deferred_Effect<boolean>;
}
interface $D152Method_isDone {
    "isDone"<A, E>(this: $D152Deferred_Deferred<A, E>): $D152Deferred_Effect<boolean>;
}
interface $D152Method_isDoneUnsafe {
    "isDoneUnsafe"<A, E>(this: $D152Deferred_Deferred<A, E>): boolean;
}
interface $D152Method_poll {
    "poll"<A, E>(this: $D152Deferred_Deferred<A, E>): $D152Deferred_Effect<$D152Deferred_Option.Option<$D152Deferred_Effect<A, E>>>;
    "poll"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Effect<$D152Queue_Option.Option<A>>;
}
interface $D152Method_succeed {
    "succeed"<A, E>(this: $D152Deferred_Deferred<A, E>, value: A): $D152Deferred_Effect<boolean>;
}
interface $D152Method_sync {
    "sync"<A, E>(this: $D152Deferred_Deferred<A, E>, evaluate: $D152Deferred_LazyArg<A>): $D152Deferred_Effect<boolean>;
}
interface $D152Method_doneUnsafe {
    "doneUnsafe"<A, E>(this: $D152Deferred_Deferred<A, E>, effect: $D152Deferred_Effect<A, E>): boolean;
}
interface $D152Method_into {
    "into"<A, E, R>(this: $D152Deferred_Effect<A, E, R>, deferred: $D152Deferred_Deferred<A, E>): $D152Deferred_Effect<boolean, never, R>;
    "into"<A, E>(this: $D152Queue_Enqueue<A, E | $D152Queue_Done>): <AX, EX extends E, RX>(effect: $D152Queue_Effect<AX, EX, RX>) => $D152Queue_Effect<boolean, never, RX>;
}
interface $D152Method_await {
    "await"<A, E>(this: $D152Deferred_Deferred<A, E>): $D152Deferred_Effect<A, E>;
    "await"<A, E>(this: $D152Fiber_Fiber<A, E>): $D152Fiber_Effect<$D152Fiber_Exit<A, E>>;
    "await"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Effect<void, Exclude<E, $D152Queue_Done>>;
}
interface $D152Method_isFinite {
    "isFinite"(this: $D152Duration_Duration): boolean;
}
interface $D152Method_toMillis {
    "toMillis"(this: $D152Duration_Input): number;
}
interface $D152Method_toSeconds {
    "toSeconds"(this: $D152Duration_Input): number;
}
interface $D152Method_toMinutes {
    "toMinutes"(this: $D152Duration_Input): number;
}
interface $D152Method_toHours {
    "toHours"(this: $D152Duration_Input): number;
}
interface $D152Method_toDays {
    "toDays"(this: $D152Duration_Input): number;
}
interface $D152Method_toWeeks {
    "toWeeks"(this: $D152Duration_Input): number;
}
interface $D152Method_toNanosUnsafe {
    "toNanosUnsafe"(this: $D152Duration_Input): bigint;
}
interface $D152Method_toNanos {
    "toNanos"(this: $D152Duration_Input): $D152Duration_Option.Option<bigint>;
}
interface $D152Method_toHrTime {
    "toHrTime"(this: $D152Duration_Input): [
    seconds: number,
    nanos: number
];
}
interface $D152Method_matchPair {
    "matchPair"<A, B, C>(this: $D152Duration_Duration, that: $D152Duration_Duration, options: {
    readonly onMillis: (self: number, that: number) => A;
    readonly onNanos: (self: bigint, that: bigint) => B;
    readonly onInfinity: (self: $D152Duration_Duration, that: $D152Duration_Duration) => C;
}): A | B | C;
}
interface $D152Method_times {
    "times"(this: $D152Duration_Duration, times: number): $D152Duration_Duration;
}
interface $D152Method_parts {
    "parts"(this: $D152Duration_Duration): {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    millis: number;
    nanos: number;
};
}
interface $D152Method_bindTo {
    "bindTo"<A, N extends string>(this: $D152Option_Option<A>, name: N): $D152Option_Option<{
    [K in N]: A;
}>;
    "bindTo"<R, L, N extends string>(this: $D152Result_Result<R, L>, name: N): $D152Result_Result<Record<N, R>, L>;
    "bindTo"<A, E, R, N extends string>(this: $D152Stream_Stream<A, E, R>, name: N): $D152Stream_Stream<{
    [K in N]: A;
}, E, R>;
    "bindTo"<A, E, R, N extends string>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, name: N): $D152Effect_Effect<{
    [K in N]: A;
}, E, R>;
}
interface $D152Method_bind {
    "bind"<A extends object, N extends string, B>(this: $D152Option_Option<A>, name: Exclude<N, keyof A>, f: (a: $D152Option_NoInfer<A>) => $D152Option_Option<B>): $D152Option_Option<{
    [K in N | keyof A]: K extends keyof A ? A[K] : B;
}>;
    "bind"<A extends object, L1, N extends string, B, L2>(this: $D152Result_Result<A, L1>, name: Exclude<N, keyof A>, f: (a: $D152Result_NoInfer<A>) => $D152Result_Result<B, L2>): $D152Result_Result<{
    [K in N | keyof A]: K extends keyof A ? A[K] : B;
}, L1 | L2>;
    "bind"<A extends Record<string, any>, E, R, B, E2, R2, N extends string>(this: $D152Stream_Stream<A, E, R>, name: N, f: (a: $D152Stream_NoInfer<A>) => $D152Stream_Stream<B, E2, R2>, options?: {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly bufferSize?: number | undefined;
} | undefined): $D152Stream_Stream<$D152Stream_Simplify<Omit<A, N> & Record<N, B>>, E | E2, R | R2>;
    "bind"<A extends Record<string, any>, E, R, B, E2, R2, N extends string>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, name: N, f: (a: $D152Effect_NoInfer<A>) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<$D152Effect_Simplify<Omit<A, N> & Record<N, B>>, E | E2, R | R2>;
}
interface $D152Method_transposeOption {
    "transposeOption"<A = never, E = never>(this: $D152Result_Option<$D152Result_Result<A, E>>): $D152Result_Result<$D152Result_Option<A>, E>;
    "transposeOption"<A = never, E = never, R = never>(this: ($D152Effect_Option<$D152Effect_Effect<A, E, R>>) & $D152EffectReceiver): $D152Effect_Effect<$D152Effect_Option<A>, E, R>;
}
interface $D152Method_andThen {
    "andThen"<A, B>(this: $D152Option_Option<A>, f: (a: A) => $D152Option_Option<B>): $D152Option_Option<B>;
    "andThen"<A, B>(this: $D152Option_Option<A>, f: $D152Option_Option<B>): $D152Option_Option<B>;
    "andThen"<A, B>(this: $D152Option_Option<A>, f: (a: A) => B): $D152Option_Option<B>;
    "andThen"<A, B>(this: $D152Option_Option<A>, f: $D152Option_NotFunction<B>): $D152Option_Option<B>;
    "andThen"<A, E, A2, E2>(this: $D152Result_Result<A, E>, f: (a: A) => $D152Result_Result<A2, E2>): $D152Result_Result<A2, E | E2>;
    "andThen"<A, E, A2, E2>(this: $D152Result_Result<A, E>, f: $D152Result_Result<A2, E2>): $D152Result_Result<A2, E | E2>;
    "andThen"<A, E, A2>(this: $D152Result_Result<A, E>, f: (a: A) => A2): $D152Result_Result<A2, E>;
    "andThen"<A, E, A2>(this: $D152Result_Result<A, E>, f: $D152Result_NotFunction<A2>): $D152Result_Result<A2, E>;
    "andThen"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (a: A) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<B, E | E2, R | R2>;
    "andThen"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<B, E | E2, R | R2>;
}
interface $D152Method_tap {
    "tap"<A, X>(this: $D152Option_Option<A>, f: (a: A) => $D152Option_Option<X>): $D152Option_Option<A>;
    "tap"<A, E>(this: $D152Result_Result<A, E>, f: (a: A) => void): $D152Result_Result<A, E>;
    "tap"<Output, Input, Error, Env, X, Error2, Env2>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, f: (metadata: $D152Schedule_Metadata<Output, Input>) => $D152Schedule_Effect<X, Error2, Env2>): $D152Schedule_Schedule<Output, Input, Error | Error2, Env | Env2>;
    "tap"<A, E, R, X, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: $D152Stream_NoInfer<A>) => $D152Stream_Effect.Effect<X, E2, R2>, options?: {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
} | undefined): $D152Stream_Stream<A, E | E2, R | R2>;
    "tap"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (a: $D152Effect_NoInfer<A>) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<A, E | E2, R | R2>;
    "tap"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<A, E | E2, R | R2>;
}
interface $D152Method_result {
    "result"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<$D152Stream_Result.Result<A, E>, never, R>;
    "result"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<$D152Effect_Result.Result<A, E>, never, R>;
}
interface $D152Method_option {
    "option"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<$D152Effect_Option<A>, never, R>;
}
interface $D152Method_exit {
    "exit"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<$D152Effect_Exit.Exit<A, E>, never, R>;
}
interface $D152Method_as {
    "as"<X, B>(this: $D152Option_Option<X>, b: B): $D152Option_Option<B>;
    "as"<A, In, L, E, R, A2>(this: $D152Sink_Sink<A, In, L, E, R>, a2: A2): $D152Sink_Sink<A2, In, L, E, R>;
    "as"<A, E, R, B>(this: $D152Stream_Stream<A, E, R>, value: B): $D152Stream_Stream<B, E, R>;
    "as"<A, E, R, B>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, value: B): $D152Effect_Effect<B, E, R>;
}
interface $D152Method_asSome {
    "asSome"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<$D152Effect_Option<A>, E, R>;
}
interface $D152Method_asVoid {
    "asVoid"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Exit<void, E>;
    "asVoid"<_>(this: $D152Option_Option<_>): $D152Option_Option<void>;
    "asVoid"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<void, E, R>;
}
interface $D152Method_flip {
    "flip"<A, E>(this: $D152Result_Result<A, E>): $D152Result_Result<E, A>;
    "flip"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<E, A, R>;
}
interface $D152Method_catchTag {
    "catchTag"<A, E, R, const K extends $D152Stream_Tags<E> | $D152Stream_Arr.NonEmptyReadonlyArray<$D152Stream_Tags<E>>, R1, E1, A1, A2 = $D152Stream_unassigned, E2 = never, R2 = never>(this: $D152Stream_Stream<A, E, R>, k: K, f: (e: $D152Stream_ExtractTag<E, K extends $D152Stream_Arr.NonEmptyReadonlyArray<string> ? K[number] : K>) => $D152Stream_Stream<A1, E1, R1>, orElse?: ((e: $D152Stream_ExcludeTag<E, K extends $D152Stream_Arr.NonEmptyReadonlyArray<string> ? K[number] : K>) => $D152Stream_Stream<A2, E2, R2>) | undefined): $D152Stream_Stream<A | A1 | Exclude<A2, $D152Stream_unassigned>, E1 | E2 | (A2 extends $D152Stream_unassigned ? $D152Stream_ExcludeTag<E, K extends $D152Stream_Arr.NonEmptyReadonlyArray<string> ? K[number] : K> : never), R | R1 | R2>;
    "catchTag"<A, E, R, const K extends $D152Effect_Tags<E> | $D152Effect_Arr.NonEmptyReadonlyArray<$D152Effect_Tags<E>>, R1, E1, A1, A2 = $D152Effect_unassigned, E2 = never, R2 = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, k: K, f: (e: $D152Effect_ExtractTag<E, K extends $D152Effect_Arr.NonEmptyReadonlyArray<string> ? K[number] : K>) => $D152Effect_Effect<A1, E1, R1>, orElse?: ((e: $D152Effect_ExcludeTag<E, K extends $D152Effect_Arr.NonEmptyReadonlyArray<string> ? K[number] : K>) => $D152Effect_Effect<A2, E2, R2>) | undefined): $D152Effect_Effect<A | A1 | Exclude<A2, $D152Effect_unassigned>, E1 | E2 | (A2 extends $D152Effect_unassigned ? $D152Effect_ExcludeTag<E, K extends $D152Effect_Arr.NonEmptyReadonlyArray<string> ? K[number] : K> : never), R | R1 | R2>;
}
interface $D152Method_catchTags {
    "catchTags"<R, E, A, Cases extends {
    [K in Extract<E, {
        _tag: string;
    }>["_tag"]]+?: ((error: Extract<E, {
        _tag: K;
    }>) => $D152Stream_Stream<any, any, any>);
} & (unknown extends E ? {} : {
    [K in Exclude<keyof Cases, Extract<E, {
        _tag: string;
    }>["_tag"]>]: never;
}), A2 = $D152Stream_unassigned, E2 = never, R2 = never>(this: $D152Stream_Stream<A, E, R>, cases: Cases, orElse?: ((e: Exclude<E, {
    _tag: keyof Cases;
}>) => $D152Stream_Stream<A2, E2, R2>) | undefined): $D152Stream_Stream<A | Exclude<A2, $D152Stream_unassigned> | {
    [K in keyof Cases]: Cases[K] extends ((...args: Array<any>) => $D152Stream_Stream<infer A, any, any>) ? A : never;
}[keyof Cases], E2 | (A2 extends $D152Stream_unassigned ? Exclude<E, {
    _tag: keyof Cases;
}> : never) | {
    [K in keyof Cases]: Cases[K] extends ((...args: Array<any>) => $D152Stream_Stream<any, infer E, any>) ? E : never;
}[keyof Cases], R | R2 | {
    [K in keyof Cases]: Cases[K] extends ((...args: Array<any>) => $D152Stream_Stream<any, any, infer R>) ? R : never;
}[keyof Cases]>;
    "catchTags"<R, E, A, Cases extends {
    [K in Extract<E, {
        _tag: string;
    }>["_tag"]]+?: ((error: Extract<E, {
        _tag: K;
    }>) => $D152Effect_Effect<any, any, any>);
} & (unknown extends E ? {} : {
    [K in Exclude<keyof Cases, Extract<E, {
        _tag: string;
    }>["_tag"]>]: never;
}), A2 = $D152Effect_unassigned, E2 = never, R2 = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, cases: Cases, orElse?: ((e: Exclude<E, {
    _tag: keyof Cases;
}>) => $D152Effect_Effect<A2, E2, R2>) | undefined): $D152Effect_Effect<A | Exclude<A2, $D152Effect_unassigned> | {
    [K in keyof Cases]: Cases[K] extends (...args: Array<any>) => $D152Effect_Effect<infer A, any, any> ? A : never;
}[keyof Cases], E2 | (A2 extends $D152Effect_unassigned ? Exclude<E, {
    _tag: keyof Cases;
}> : never) | {
    [K in keyof Cases]: Cases[K] extends (...args: Array<any>) => $D152Effect_Effect<any, infer E, any> ? E : never;
}[keyof Cases], R | R2 | {
    [K in keyof Cases]: Cases[K] extends (...args: Array<any>) => $D152Effect_Effect<any, any, infer R> ? R : never;
}[keyof Cases]>;
}
interface $D152Method_catchReason {
    "catchReason"<A, E, R, K extends $D152Stream_Tags<E>, RK extends $D152Stream_ReasonTags<$D152Stream_ExtractTag<E, K>>, A2, E2, R2, A3 = $D152Stream_unassigned, E3 = never, R3 = never>(this: $D152Stream_Stream<A, E, R>, errorTag: K, reasonTag: RK, f: (reason: $D152Stream_ExtractReason<$D152Stream_ExtractTag<E, K>, RK>, error: $D152Stream_NarrowReason<$D152Stream_ExtractTag<E, K>, RK>) => $D152Stream_Stream<A2, E2, R2>, orElse?: ((reason: $D152Stream_ExcludeReason<$D152Stream_ExtractTag<E, K>, RK>, error: $D152Stream_OmitReason<$D152Stream_ExtractTag<E, K>, RK>) => $D152Stream_Stream<A3, E3, R3>) | undefined): $D152Stream_Stream<A | A2 | Exclude<A3, $D152Stream_unassigned>, $D152Stream_ExcludeTag<E, K> | E2 | E3 | (A3 extends $D152Stream_unassigned ? $D152Stream_ExtractTag<E, K> : never), R | R2 | R3>;
    "catchReason"<A, E, R, K extends $D152Effect_Tags<E>, RK extends $D152Effect_ReasonTags<$D152Effect_ExtractTag<E, K>>, A2, E2, R2, A3 = $D152Effect_unassigned, E3 = never, R3 = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, errorTag: K, reasonTag: RK, f: (reason: $D152Effect_ExtractReason<$D152Effect_ExtractTag<E, K>, RK>, error: $D152Effect_NarrowReason<$D152Effect_ExtractTag<E, K>, RK>) => $D152Effect_Effect<A2, E2, R2>, orElse?: ((reasons: $D152Effect_ExcludeReason<$D152Effect_ExtractTag<E, K>, RK>, error: $D152Effect_OmitReason<$D152Effect_ExtractTag<E, K>, RK>) => $D152Effect_Effect<A3, E3, R3>) | undefined): $D152Effect_Effect<A | A2 | Exclude<A3, $D152Effect_unassigned>, $D152Effect_ExcludeTag<E, K> | E2 | E3 | (A3 extends $D152Effect_unassigned ? $D152Effect_ExtractTag<E, K> : never), R | R2 | R3>;
}
interface $D152Method_catchReasons {
    "catchReasons"<A, E, R, K extends $D152Stream_Tags<E>, Cases extends {
    [RK in $D152Stream_ReasonTags<$D152Stream_ExtractTag<E, K>>]+?: (reason: $D152Stream_ExtractReason<$D152Stream_ExtractTag<E, K>, RK>, error: $D152Stream_NarrowReason<$D152Stream_ExtractTag<E, K>, RK>) => $D152Stream_Stream<any, any, any>;
}, A2 = $D152Stream_unassigned, E2 = never, R2 = never>(this: $D152Stream_Stream<A, E, R>, errorTag: K, cases: Cases, orElse?: ((reason: $D152Stream_ExcludeReason<$D152Stream_ExtractTag<$D152Stream_NoInfer<E>, K>, Extract<keyof Cases, string>>, error: $D152Stream_OmitReason<$D152Stream_ExtractTag<$D152Stream_NoInfer<E>, K>, Extract<keyof Cases, string>>) => $D152Stream_Stream<A2, E2, R2>) | undefined): $D152Stream_Stream<A | Exclude<A2, $D152Stream_unassigned> | {
    [RK in keyof Cases]: Cases[RK] extends (...args: Array<any>) => $D152Stream_Stream<infer A, any, any> ? A : never;
}[keyof Cases], $D152Stream_ExcludeTag<E, K> | E2 | (A2 extends $D152Stream_unassigned ? $D152Stream_ExtractTag<E, K> : never) | {
    [RK in keyof Cases]: Cases[RK] extends (...args: Array<any>) => $D152Stream_Stream<any, infer E, any> ? E : never;
}[keyof Cases], R | R2 | {
    [RK in keyof Cases]: Cases[RK] extends (...args: Array<any>) => $D152Stream_Stream<any, any, infer R> ? R : never;
}[keyof Cases]>;
    "catchReasons"<A, E, R, K extends $D152Effect_Tags<E>, Cases extends {
    [RK in $D152Effect_ReasonTags<$D152Effect_ExtractTag<E, K>>]+?: (reason: $D152Effect_ExtractReason<$D152Effect_ExtractTag<E, K>, RK>, error: $D152Effect_NarrowReason<$D152Effect_ExtractTag<E, K>, RK>) => $D152Effect_Effect<any, any, any>;
}, A2 = $D152Effect_unassigned, E2 = never, R2 = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, errorTag: K, cases: Cases, orElse?: ((reason: $D152Effect_ExcludeReason<$D152Effect_ExtractTag<$D152Effect_NoInfer<E>, K>, Extract<keyof Cases, string>>, error: $D152Effect_OmitReason<$D152Effect_ExtractTag<$D152Effect_NoInfer<E>, K>, Extract<keyof Cases, string>>) => $D152Effect_Effect<A2, E2, R2>) | undefined): $D152Effect_Effect<A | Exclude<A2, $D152Effect_unassigned> | {
    [RK in keyof Cases]: Cases[RK] extends (...args: Array<any>) => $D152Effect_Effect<infer A, any, any> ? A : never;
}[keyof Cases], $D152Effect_ExcludeTag<E, K> | E2 | (A2 extends $D152Effect_unassigned ? $D152Effect_ExtractTag<E, K> : never) | {
    [RK in keyof Cases]: Cases[RK] extends (...args: Array<any>) => $D152Effect_Effect<any, infer E, any> ? E : never;
}[keyof Cases], R | R2 | {
    [RK in keyof Cases]: Cases[RK] extends (...args: Array<any>) => $D152Effect_Effect<any, any, infer R> ? R : never;
}[keyof Cases]>;
}
interface $D152Method_unwrapReason {
    "unwrapReason"<A, E, R, K extends $D152Stream_Effect.TagsWithReason<E>>(this: $D152Stream_Stream<A, E, R>, errorTag: K): $D152Stream_Stream<A, $D152Stream_ExcludeTag<E, K> | $D152Stream_ReasonOf<$D152Stream_ExtractTag<E, K>>, R>;
    "unwrapReason"<A, E, R, K extends $D152Effect_TagsWithReason<E>>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, errorTag: K): $D152Effect_Effect<A, $D152Effect_ExcludeTag<E, K> | $D152Effect_ReasonOf<$D152Effect_ExtractTag<E, K>>, R>;
}
interface $D152Method_catchCause {
    "catchCause"<A, In, L, E, R, A2, E2, R2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (error: $D152Sink_Cause.Cause<E>) => $D152Sink_Effect.Effect<A2, E2, R2>): $D152Sink_Sink<A | A2, In, L, E2, R | R2>;
    "catchCause"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (cause: $D152Stream_Cause.Cause<E>) => $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<A | A2, E2, R | R2>;
    "catchCause"<A, E, R, A2, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<A2, E2, R2>): $D152Effect_Effect<A | A2, E2, R | R2>;
}
interface $D152Method_catchDefect {
    "catchDefect"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (defect: unknown) => $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<A | A2, E | E2, R | R2>;
    "catchDefect"<A, E, R, A2, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (defect: unknown) => $D152Effect_Effect<A2, E2, R2>): $D152Effect_Effect<A | A2, E | E2, R | R2>;
}
interface $D152Method_catchIf {
    "catchIf"<A, E, R, EB extends E, A2, E2, R2, A3 = $D152Stream_unassigned, E3 = never, R3 = never>(this: $D152Stream_Stream<A, E, R>, refinement: $D152Stream_Refinement<$D152Stream_NoInfer<E>, EB>, f: (e: EB) => $D152Stream_Stream<A2, E2, R2>, orElse?: ((e: Exclude<E, EB>) => $D152Stream_Stream<A3, E3, R3>) | undefined): $D152Stream_Stream<A | A2 | Exclude<A3, $D152Stream_unassigned>, E2 | E3 | (A3 extends $D152Stream_unassigned ? Exclude<E, EB> : never), R | R2 | R3>;
    "catchIf"<A, E, R, A2, E2, R2, A3 = $D152Stream_unassigned, E3 = never, R3 = never>(this: $D152Stream_Stream<A, E, R>, predicate: $D152Stream_Predicate<E>, f: (e: E) => $D152Stream_Stream<A2, E2, R2>, orElse?: ((e: E) => $D152Stream_Stream<A3, E3, R3>) | undefined): $D152Stream_Stream<A | A2 | Exclude<A3, $D152Stream_unassigned>, E2 | E3 | (A3 extends $D152Stream_unassigned ? E : never), R | R2 | R3>;
    "catchIf"<A, E, R, EB extends E, A2, E2, R2, A3 = $D152Effect_unassigned, E3 = never, R3 = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, refinement: $D152Effect_Predicate.Refinement<$D152Effect_NoInfer<E>, EB>, f: (e: EB) => $D152Effect_Effect<A2, E2, R2>, orElse?: ((e: Exclude<E, EB>) => $D152Effect_Effect<A3, E3, R3>) | undefined): $D152Effect_Effect<A | A2 | Exclude<A3, $D152Effect_unassigned>, E2 | E3 | (A3 extends $D152Effect_unassigned ? Exclude<E, EB> : never), R | R2 | R3>;
    "catchIf"<A, E, R, A2, E2, R2, A3 = $D152Effect_unassigned, E3 = never, R3 = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, predicate: $D152Effect_Predicate.Predicate<E>, f: (e: E) => $D152Effect_Effect<A2, E2, R2>, orElse?: ((e: E) => $D152Effect_Effect<A3, E3, R3>) | undefined): $D152Effect_Effect<A | A2 | Exclude<A3, $D152Effect_unassigned>, E2 | E3 | (A3 extends $D152Effect_unassigned ? E : never), R | R2 | R3>;
}
interface $D152Method_catchFilter {
    "catchFilter"<A, E, R, EB, A2, E2, R2, X, A3 = $D152Stream_unassigned, E3 = never, R3 = never>(this: $D152Stream_Stream<A, E, R>, filter: $D152Stream_Filter.Filter<$D152Stream_NoInfer<E>, EB, X>, f: (failure: EB) => $D152Stream_Stream<A2, E2, R2>, orElse?: ((failure: X) => $D152Stream_Stream<A3, E3, R3>) | undefined): $D152Stream_Stream<A | A2 | Exclude<A3, $D152Stream_unassigned>, E2 | E3 | (A3 extends $D152Stream_unassigned ? X : never), R | R2 | R3>;
    "catchFilter"<A, E, R, EB, A2, E2, R2, X, A3 = $D152Effect_unassigned, E3 = never, R3 = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, filter: $D152Effect_Filter.Filter<$D152Effect_NoInfer<E>, EB, X>, f: (e: EB) => $D152Effect_Effect<A2, E2, R2>, orElse?: ((e: X) => $D152Effect_Effect<A3, E3, R3>) | undefined): $D152Effect_Effect<A | A2 | Exclude<A3, $D152Effect_unassigned>, E2 | E3 | (A3 extends $D152Effect_unassigned ? X : never), R | R2 | R3>;
}
interface $D152Method_catchNoSuchElement {
    "catchNoSuchElement"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<$D152Effect_Option<A>, Exclude<E, $D152Effect_Cause.NoSuchElementError>, R>;
}
interface $D152Method_catchCauseIf {
    "catchCauseIf"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, predicate: $D152Stream_Predicate<$D152Stream_Cause.Cause<E>>, f: (cause: $D152Stream_Cause.Cause<E>) => $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<A | A2, E | E2, R | R2>;
    "catchCauseIf"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, predicate: $D152Effect_Predicate.Predicate<$D152Effect_Cause.Cause<E>>, f: (cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<A | B, E | E2, R | R2>;
}
interface $D152Method_catchCauseFilter {
    "catchCauseFilter"<A, E, R, EB, A2, E2, R2, X extends $D152Stream_Cause.Cause<any>>(this: $D152Stream_Stream<A, E, R>, filter: $D152Stream_Filter.Filter<$D152Stream_Cause.Cause<E>, EB, X>, f: (failure: EB, cause: $D152Stream_Cause.Cause<E>) => $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<A | A2, $D152Stream_Cause.Cause.Error<X> | E2, R | R2>;
    "catchCauseFilter"<A, E, R, B, E2, R2, EB, X extends $D152Effect_Cause.Cause<any>>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, filter: $D152Effect_Filter.Filter<$D152Effect_Cause.Cause<E>, EB, X>, f: (failure: EB, cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<A | B, $D152Effect_Cause.Cause.Error<X> | E2, R | R2>;
}
interface $D152Method_mapError {
    "mapError"<A, E, E2>(this: $D152Exit_Exit<A, E>, f: (a: $D152Exit_NoInfer<E>) => E2): $D152Exit_Exit<A, E2>;
    "mapError"<A, E, E2>(this: $D152Result_Result<A, E>, f: (err: E) => E2): $D152Result_Result<A, E2>;
    "mapError"<A, In, L, E, R, E2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (error: E) => E2): $D152Sink_Sink<A, In, L, E2, R>;
    "mapError"<A, E, R, E2>(this: $D152Stream_Stream<A, E, R>, f: (error: E) => E2): $D152Stream_Stream<A, E2, R>;
    "mapError"<A, E, R, E2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (e: E) => E2): $D152Effect_Effect<A, E2, R>;
}
interface $D152Method_mapBoth {
    "mapBoth"<A, E, E2, A2>(this: $D152Exit_Exit<A, E>, options: {
    readonly onFailure: (e: E) => E2;
    readonly onSuccess: (a: A) => A2;
}): $D152Exit_Exit<A2, E2>;
    "mapBoth"<E, A, E2, A2>(this: $D152Result_Result<A, E>, options: {
    readonly onFailure: (left: E) => E2;
    readonly onSuccess: (right: A) => A2;
}): $D152Result_Result<A2, E2>;
    "mapBoth"<A, E, R, A2, E2>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly onElement: (a: A) => A2;
    readonly onError: (e: E) => E2;
}): $D152Stream_Stream<A2, E2, R>;
    "mapBoth"<A, E, R, E2, A2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (e: E) => E2;
    readonly onSuccess: (a: A) => A2;
}): $D152Effect_Effect<A2, E2, R>;
}
interface $D152Method_orDie {
    "orDie"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<A, never, R>;
    "orDie"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, never, R>;
}
interface $D152Method_tapError {
    "tapError"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (error: E) => $D152Stream_Effect.Effect<A2, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
    "tapError"<A, E, R, X, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (e: E) => $D152Effect_Effect<X, E2, R2>): $D152Effect_Effect<A, E | E2, R | R2>;
}
interface $D152Method_tapErrorTag {
    "tapErrorTag"<A, E, R, const K extends $D152Stream_Tags<E> | $D152Stream_Arr.NonEmptyReadonlyArray<$D152Stream_Tags<E>>, R1, E1, A1>(this: $D152Stream_Stream<A, E, R>, k: K, f: (e: $D152Stream_ExtractTag<E, K extends $D152Stream_Arr.NonEmptyReadonlyArray<string> ? K[number] : K>) => $D152Stream_Effect.Effect<A1, E1, R1>): $D152Stream_Stream<A, E | E1, R | R1>;
    "tapErrorTag"<A, E, R, const K extends $D152Effect_Tags<E> | $D152Effect_Arr.NonEmptyReadonlyArray<$D152Effect_Tags<E>>, R1, E1, A1>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, k: K, f: (e: $D152Effect_ExtractTag<E, K extends $D152Effect_Arr.NonEmptyReadonlyArray<string> ? K[number] : K>) => $D152Effect_Effect<A1, E1, R1>): $D152Effect_Effect<A, E | E1, R | R1>;
}
interface $D152Method_tapCause {
    "tapCause"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (cause: $D152Stream_Cause.Cause<E>) => $D152Stream_Effect.Effect<A2, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
    "tapCause"<A, E, R, X, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<X, E2, R2>): $D152Effect_Effect<A, E | E2, R | R2>;
}
interface $D152Method_tapCauseIf {
    "tapCauseIf"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, predicate: $D152Effect_Predicate.Predicate<$D152Effect_Cause.Cause<E>>, f: (cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<A, E | E2, R | R2>;
}
interface $D152Method_tapCauseFilter {
    "tapCauseFilter"<A, E, R, B, E2, R2, EB, X extends $D152Effect_Cause.Cause<any>>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, filter: $D152Effect_Filter.Filter<$D152Effect_Cause.Cause<E>, EB, X>, f: (a: EB, cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<A, E | E2, R | R2>;
}
interface $D152Method_tapDefect {
    "tapDefect"<A, E, R, B, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (defect: unknown) => $D152Stream_Effect.Effect<B, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
    "tapDefect"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (defect: unknown) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<A, E | E2, R | R2>;
}
interface $D152Method_eventually {
    "eventually"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, never, R>;
}
interface $D152Method_retry {
    "retry"<A, E, R, X, E2, R2>(this: $D152Stream_Stream<A, E, R>, policy: $D152Stream_Schedule.Schedule<X, $D152Stream_NoInfer<E>, E2, R2> | (($: <SO, SE, SR>(_: $D152Stream_Schedule.Schedule<SO, $D152Stream_NoInfer<E>, SE, SR>) => $D152Stream_Schedule.Schedule<SO, E, SE, SR>) => $D152Stream_Schedule.Schedule<X, $D152Stream_NoInfer<E>, E2, R2>)): $D152Stream_Stream<A, E | E2, R2 | R>;
    "retry"<A, E, R, O extends $D152Effect_Retry.Options<E>>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: O): $D152Effect_Retry.Return<R, E, A, O>;
    "retry"<A, E, R, B, Error, Env>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, policy: $D152Effect_Schedule<B, $D152Effect_NoInfer<E>, Error, Env>): $D152Effect_Effect<A, E | Error, R | Env>;
    "retry"<A, E, R, B, Error, Env>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, builder: ($: <O, SE, R>(_: $D152Effect_Schedule<O, $D152Effect_NoInfer<E>, SE, R>) => $D152Effect_Schedule<O, E, SE, R>) => $D152Effect_Schedule<B, $D152Effect_NoInfer<E>, Error, Env>): $D152Effect_Effect<A, E | Error, R | Env>;
}
interface $D152Method_retryOrElse {
    "retryOrElse"<A, E, R, A1, E1, R1, A2, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, policy: $D152Effect_Schedule<A1, $D152Effect_NoInfer<E>, E1, R1>, orElse: (e: $D152Effect_NoInfer<E>, out: A1) => $D152Effect_Effect<A2, E2, R2>): $D152Effect_Effect<A | A2, E1 | E2, R | R1 | R2>;
}
interface $D152Method_sandbox {
    "sandbox"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, $D152Effect_Cause.Cause<E>, R>;
}
interface $D152Method_ignore {
    "ignore"<Arg extends $D152Stream_Stream<any, any, any> | {
    readonly log?: boolean | $D152Stream_Severity | undefined;
} | undefined>(this: Arg, options?: {
    readonly log?: boolean | $D152Stream_Severity | undefined;
} | undefined): [
    Arg
] extends [
    $D152Stream_Stream<infer A, infer _E, infer R>
] ? $D152Stream_Stream<A, never, R> : <A, E, R>(self: $D152Stream_Stream<A, E, R>) => $D152Stream_Stream<A, never, R>;
    "ignore"<Arg extends $D152Effect_Effect<any, any, any> | {
    readonly log?: boolean | $D152Effect_Severity | undefined;
    readonly message?: string | undefined;
} | undefined = {
    readonly log?: boolean | $D152Effect_Severity | undefined;
    readonly message?: string | undefined;
}>(this: (Arg) & $D152EffectReceiver, options?: {
    readonly log?: boolean | $D152Effect_Severity | undefined;
    readonly message?: string | undefined;
} | undefined): [
    Arg
] extends [
    $D152Effect_Effect<infer _A, infer _E, infer _R>
] ? $D152Effect_Effect<void, never, _R> : <A, E, R>(self: $D152Effect_Effect<A, E, R>) => $D152Effect_Effect<void, never, R>;
}
interface $D152Method_ignoreCause {
    "ignoreCause"<Arg extends $D152Stream_Stream<any, any, any> | {
    readonly log?: boolean | $D152Stream_Severity | undefined;
} | undefined>(this: Arg, options?: {
    readonly log?: boolean | $D152Stream_Severity | undefined;
} | undefined): [
    Arg
] extends [
    $D152Stream_Stream<infer A, infer _E, infer R>
] ? $D152Stream_Stream<A, never, R> : <A, E, R>(self: $D152Stream_Stream<A, E, R>) => $D152Stream_Stream<A, never, R>;
    "ignoreCause"<Arg extends $D152Effect_Effect<any, any, any> | {
    readonly log?: boolean | $D152Effect_Severity | undefined;
    readonly message?: string | undefined;
} | undefined = {
    readonly log?: boolean | $D152Effect_Severity | undefined;
    readonly message?: string | undefined;
}>(this: (Arg) & $D152EffectReceiver, options?: {
    readonly log?: boolean | $D152Effect_Severity | undefined;
    readonly message?: string | undefined;
} | undefined): [
    Arg
] extends [
    $D152Effect_Effect<infer _A, infer _E, infer _R>
] ? $D152Effect_Effect<void, never, _R> : <A, E, R>(self: $D152Effect_Effect<A, E, R>) => $D152Effect_Effect<void, never, R>;
}
interface $D152Method_withExecutionPlan {
    "withExecutionPlan"<A, E extends Input, R, R2, Input, Provides, PolicyE, RX = never>(this: $D152Stream_Stream<A, E, R>, policy: $D152Stream_ExecutionPlan.ExecutionPlan<{
    provides: Provides;
    input: Input;
    error: PolicyE;
    requirements: R2;
}>, options?: {
    readonly preventFallbackOnPartialStream?: boolean | undefined;
    readonly onEvent?: ((event: $D152Stream_ExecutionPlan.Event<E | PolicyE>) => $D152Stream_Effect.Effect<void, never, RX>) | undefined;
}): $D152Stream_Stream<A, E | PolicyE, R2 | Exclude<R, Provides> | RX>;
    "withExecutionPlan"<A, E extends Input, R, Provides, Input, PlanE, PlanR, RX = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, plan: $D152Effect_ExecutionPlan.ExecutionPlan<{
    provides: Provides;
    input: Input;
    error: PlanE;
    requirements: PlanR;
}>, options?: {
    readonly onEvent?: ((event: $D152Effect_ExecutionPlan.Event<E | PlanE>) => $D152Effect_Effect<void, never, RX>) | undefined;
}): $D152Effect_Effect<A, E | PlanE, Exclude<R, Provides> | PlanR | RX>;
}
interface $D152Method_withErrorReporting {
    "withErrorReporting"<Arg extends $D152Effect_Effect<any, any, any> | {
    readonly defectsOnly?: boolean | undefined;
} | undefined = {
    readonly defectsOnly?: boolean | undefined;
}>(this: (Arg) & $D152EffectReceiver, options?: {
    readonly defectsOnly?: boolean | undefined;
} | undefined): [
    Arg
] extends [
    $D152Effect_Effect<infer A, infer E, infer R>
] ? $D152Effect_Effect<A, E, R> : <A, E, R>(self: $D152Effect_Effect<A, E, R>) => $D152Effect_Effect<A, E, R>;
}
interface $D152Method_orElseSucceed {
    "orElseSucceed"<A, E, R, A2>(this: $D152Stream_Stream<A, E, R>, f: (error: E) => A2): $D152Stream_Stream<A | A2, never, R>;
    "orElseSucceed"<A, E, R, A2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (error: E) => A2): $D152Effect_Effect<A | A2, never, R>;
}
interface $D152Method_timeout {
    "timeout"<A, E, R>(this: $D152Stream_Stream<A, E, R>, duration: $D152Stream_Duration.Input): $D152Stream_Stream<A, E, R>;
    "timeout"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, duration: $D152Effect_Duration.Input): $D152Effect_Effect<A, E | $D152Effect_Cause.TimeoutError, R>;
}
interface $D152Method_timeoutOption {
    "timeoutOption"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, duration: $D152Effect_Duration.Input): $D152Effect_Effect<$D152Effect_Option<A>, E, R>;
}
interface $D152Method_timeoutOrElse {
    "timeoutOrElse"<A, E, R, B, E2, R2>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly duration: $D152Stream_Duration.Input;
    readonly orElse: () => $D152Stream_Stream<B, E2, R2>;
}): $D152Stream_Stream<A | B, E | E2, R | R2>;
    "timeoutOrElse"<A, E, R, A2, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly duration: $D152Effect_Duration.Input;
    readonly orElse: $D152Effect_LazyArg<$D152Effect_Effect<A2, E2, R2>>;
}): $D152Effect_Effect<A | A2, E | E2, R | R2>;
}
interface $D152Method_delay {
    "delay"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, duration: $D152Effect_Duration.Input): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_timed {
    "timed"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<[
    duration: $D152Effect_Duration.Duration,
    result: A
], E, R>;
}
interface $D152Method_race {
    "race"<AL, EL, RL, AR, ER, RR>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>): $D152Stream_Stream<AL | AR, EL | ER, RL | RR>;
    "race"<A, E, R, A2, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, that: $D152Effect_Effect<A2, E2, R2>, options?: {
    readonly onWinner?: (options: {
        readonly fiber: $D152Effect_Fiber<any, any>;
        readonly index: number;
        readonly parentFiber: $D152Effect_Fiber<any, any>;
    }) => void;
}): $D152Effect_Effect<A | A2, E | E2, R | R2>;
}
interface $D152Method_raceFirst {
    "raceFirst"<A, E, R, A2, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, that: $D152Effect_Effect<A2, E2, R2>, options?: {
    readonly onWinner?: (options: {
        readonly fiber: $D152Effect_Fiber<any, any>;
        readonly index: number;
        readonly parentFiber: $D152Effect_Fiber<any, any>;
    }) => void;
}): $D152Effect_Effect<A | A2, E | E2, R | R2>;
}
interface $D152Method_filterOrElse {
    "filterOrElse"<A, E, R, C, E2, R2, B extends A>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, refinement: $D152Effect_Predicate.Refinement<A, B>, orElse: (a: $D152Effect_EqualsWith<A, B, A, Exclude<A, B>>) => $D152Effect_Effect<C, E2, R2>): $D152Effect_Effect<B | C, E | E2, R | R2>;
    "filterOrElse"<A, E, R, C, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, predicate: $D152Effect_Predicate.Predicate<$D152Effect_NoInfer<A>>, orElse: (a: $D152Effect_NoInfer<A>) => $D152Effect_Effect<C, E2, R2>): $D152Effect_Effect<A | C, E | E2, R | R2>;
}
interface $D152Method_filterMapOrElse {
    "filterMapOrElse"<A, E, R, B, X, C, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, filter: $D152Effect_Filter.Filter<$D152Effect_NoInfer<A>, B, X>, orElse: (x: X) => $D152Effect_Effect<C, E2, R2>): $D152Effect_Effect<B | C, E | E2, R | R2>;
}
interface $D152Method_filterOrFail {
    "filterOrFail"<A, E, B extends A, E2>(this: $D152Result_Result<A, E>, refinement: $D152Result_Refinement<A, B>, orFailWith: (value: A) => E2): $D152Result_Result<B, E | E2>;
    "filterOrFail"<A, E, E2>(this: $D152Result_Result<A, E>, predicate: $D152Result_Predicate<A>, orFailWith: (value: A) => E2): $D152Result_Result<A, E | E2>;
    "filterOrFail"<A, E, R, E2, B extends A>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, refinement: $D152Effect_Predicate.Refinement<$D152Effect_NoInfer<A>, B>, orFailWith: (a: $D152Effect_NoInfer<A>) => E2): $D152Effect_Effect<B, E2 | E, R>;
    "filterOrFail"<A, E, R, E2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, predicate: $D152Effect_Predicate.Predicate<$D152Effect_NoInfer<A>>, orFailWith: (a: $D152Effect_NoInfer<A>) => E2): $D152Effect_Effect<A, E2 | E, R>;
    "filterOrFail"<A, E, R, B extends A>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, refinement: $D152Effect_Predicate.Refinement<$D152Effect_NoInfer<A>, B>): $D152Effect_Effect<B, E | $D152Effect_Cause.NoSuchElementError, R>;
    "filterOrFail"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, predicate: $D152Effect_Predicate.Predicate<$D152Effect_NoInfer<A>>): $D152Effect_Effect<A, E | $D152Effect_Cause.NoSuchElementError, R>;
}
interface $D152Method_filterMapOrFail {
    "filterMapOrFail"<A, E, R, B, X, E2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, filter: $D152Effect_Filter.Filter<A, B, X>, orFailWith: (x: X) => E2): $D152Effect_Effect<B, E2 | E, R>;
    "filterMapOrFail"<A, E, R, B, X>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, filter: $D152Effect_Filter.Filter<A, B, X>): $D152Effect_Effect<B, $D152Effect_Cause.NoSuchElementError | E, R>;
}
interface $D152Method_when {
    "when"<A, E, R, EX = never, RX = never>(this: $D152Stream_Stream<A, E, R>, test: $D152Stream_Effect.Effect<boolean, EX, RX>): $D152Stream_Stream<A, E | EX, R | RX>;
    "when"<A, E, R, E2 = never, R2 = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, condition: $D152Effect_Effect<boolean, E2, R2>): $D152Effect_Effect<$D152Effect_Option<A>, E | E2, R | R2>;
}
interface $D152Method_matchEager {
    "matchEager"<A, E, R, A2, A3>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (error: E) => A2;
    readonly onSuccess: (value: A) => A3;
}): $D152Effect_Effect<A2 | A3, never, R>;
}
interface $D152Method_matchCause {
    "matchCause"<A, E, R, A2, A3>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (cause: $D152Effect_Cause.Cause<E>) => A2;
    readonly onSuccess: (a: A) => A3;
}): $D152Effect_Effect<A2 | A3, never, R>;
}
interface $D152Method_matchCauseEager {
    "matchCauseEager"<A, E, R, A2, A3>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (cause: $D152Effect_Cause.Cause<E>) => A2;
    readonly onSuccess: (value: A) => A3;
}): $D152Effect_Effect<A2 | A3, never, R>;
}
interface $D152Method_matchCauseEffectEager {
    "matchCauseEffectEager"<A, E, R, A2, E2, R2, A3, E3, R3>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<A2, E2, R2>;
    readonly onSuccess: (a: A) => $D152Effect_Effect<A3, E3, R3>;
}): $D152Effect_Effect<A2 | A3, E2 | E3, R2 | R3 | R>;
}
interface $D152Method_matchCauseEffect {
    "matchCauseEffect"<A, E, R, A2, E2, R2, A3, E3, R3>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<A2, E2, R2>;
    readonly onSuccess: (a: A) => $D152Effect_Effect<A3, E3, R3>;
}): $D152Effect_Effect<A2 | A3, E2 | E3, R2 | R3 | R>;
}
interface $D152Method_matchEffect {
    "matchEffect"<A, E, R, A2, E2, R2, A3, E3, R3>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (e: E) => $D152Effect_Effect<A2, E2, R2>;
    readonly onSuccess: (a: A) => $D152Effect_Effect<A3, E3, R3>;
}): $D152Effect_Effect<A2 | A3, E2 | E3, R2 | R3 | R>;
}
interface $D152Method_isFailure {
    "isFailure"<A, E>(this: $D152Exit_Exit<A, E>): this is $D152Exit_Failure<A, E>;
    "isFailure"<A, E>(this: $D152Result_Result<A, E>): this is $D152Result_Failure<A, E>;
    "isFailure"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<boolean, never, R>;
}
interface $D152Method_isSuccess {
    "isSuccess"<A, E>(this: $D152Exit_Exit<A, E>): this is $D152Exit_Success<A, E>;
    "isSuccess"<A, E>(this: $D152Result_Result<A, E>): this is $D152Result_Success<A, E>;
    "isSuccess"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<boolean, never, R>;
}
interface $D152Method_provide {
    "provide"<A, E, R, AL, EL = never, RL = never>(this: $D152Stream_Stream<A, E, R>, layer: $D152Stream_Layer.Layer<AL, EL, RL> | $D152Stream_Context.Context<AL>, options?: {
    readonly local?: boolean | undefined;
} | undefined): $D152Stream_Stream<A, E | EL, Exclude<R, AL> | RL>;
    "provide"<A, E, R, const Layers extends [
    $D152Effect_Layer.Any,
    ...Array<$D152Effect_Layer.Any>
]>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, layers: Layers, options?: {
    readonly local?: boolean | undefined;
} | undefined): $D152Effect_Effect<A, E | $D152Effect_Layer.Error<Layers[number]>, $D152Effect_Layer.Services<Layers[number]> | Exclude<R, $D152Effect_Layer.Success<Layers[number]>>>;
    "provide"<A, E, R, ROut, E2, RIn>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, layer: $D152Effect_Layer.Layer<ROut, E2, RIn>, options?: {
    readonly local?: boolean | undefined;
} | undefined): $D152Effect_Effect<A, E | E2, RIn | Exclude<R, ROut>>;
    "provide"<A, E, R, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, context: $D152Effect_Context.Context<R2>): $D152Effect_Effect<A, E, Exclude<R, R2>>;
}
interface $D152Method_provideContext {
    "provideContext"<A, In, L, E, R, Provided>(this: $D152Sink_Sink<A, In, L, E, R>, context: $D152Sink_Context.Context<Provided>): $D152Sink_Sink<A, In, L, E, Exclude<R, Provided>>;
    "provideContext"<A, E, R, R2>(this: $D152Stream_Stream<A, E, R>, context: $D152Stream_Context.Context<R2>): $D152Stream_Stream<A, E, Exclude<R, R2>>;
    "provideContext"<A, E, R, XR>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, context: $D152Effect_Context.Context<XR>): $D152Effect_Effect<A, E, Exclude<R, XR>>;
}
interface $D152Method_setContext {
    "setContext"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, context: $D152Effect_Context.Context<R>): $D152Effect_Effect<A, E>;
}
interface $D152Method_updateContext {
    "updateContext"<A, E, R, R2>(this: $D152Stream_Stream<A, E, R>, f: (context: $D152Stream_Context.Context<R2>) => $D152Stream_Context.Context<R>): $D152Stream_Stream<A, E, R2>;
    "updateContext"<A, E, R, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (context: $D152Effect_Context.Context<R2>) => $D152Effect_Context.Context<$D152Effect_NoInfer<R>>): $D152Effect_Effect<A, E, R2>;
}
interface $D152Method_updateService {
    "updateService"<A, E, R, I, S>(this: $D152Stream_Stream<A, E, R>, key: $D152Stream_Context.Key<I, S>, f: (service: $D152Stream_NoInfer<S>) => S): $D152Stream_Stream<A, E, R | I>;
    "updateService"<XA, E, R, I, A>(this: ($D152Effect_Effect<XA, E, R>) & $D152EffectReceiver, service: $D152Effect_Context.Key<I, A>, f: (value: A) => $D152Effect_NoInfer<A>): $D152Effect_Effect<XA, E, R | I>;
}
interface $D152Method_provideService {
    "provideService"<A, In, L, E, R, I, S>(this: $D152Sink_Sink<A, In, L, E, R>, key: $D152Sink_Context.Key<I, S>, value: $D152Sink_Types.NoInfer<S>): $D152Sink_Sink<A, In, L, E, Exclude<R, I>>;
    "provideService"<A, E, R, I, S>(this: $D152Stream_Stream<A, E, R>, key: $D152Stream_Context.Key<I, S>, service: $D152Stream_NoInfer<S>): $D152Stream_Stream<A, E, Exclude<R, I>>;
    "provideService"<A, E, R, I, S>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, service: $D152Effect_Context.Key<I, S>, implementation: S): $D152Effect_Effect<A, E, Exclude<R, I>>;
}
interface $D152Method_provideServiceEffect {
    "provideServiceEffect"<A, E, R, I, S, ES, RS>(this: $D152Stream_Stream<A, E, R>, key: $D152Stream_Context.Key<I, S>, service: $D152Stream_Effect.Effect<$D152Stream_NoInfer<S>, ES, RS>): $D152Stream_Stream<A, E | ES, Exclude<R, I> | RS>;
    "provideServiceEffect"<A, E, R, I, S, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, service: $D152Effect_Context.Key<I, S>, acquire: $D152Effect_Effect<$D152Effect_NoInfer<S>, E2, R2>): $D152Effect_Effect<A, E | E2, Exclude<R, I> | R2>;
}
interface $D152Method_scoped {
    "scoped"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<A, E, Exclude<R, $D152Stream_Scope.Scope>>;
    "scoped"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, E, Exclude<R, $D152Effect_Scope>>;
}
interface $D152Method_ensuring {
    "ensuring"<A, In, L, E, R, X, E2, R2>(this: $D152Sink_Sink<A, In, L, E, R>, effect: $D152Sink_Effect.Effect<X, E2, R2>): $D152Sink_Sink<A, In, L, E | E2, R | R2>;
    "ensuring"<A, E, R, R2>(this: $D152Stream_Stream<A, E, R>, finalizer: $D152Stream_Effect.Effect<unknown, never, R2>): $D152Stream_Stream<A, E, R | R2>;
    "ensuring"<A, E, R, X, R1>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, finalizer: $D152Effect_Effect<X, never, R1>): $D152Effect_Effect<A, E, R1 | R>;
}
interface $D152Method_onError {
    "onError"<A, E, R, X, R2>(this: $D152Stream_Stream<A, E, R>, cleanup: (cause: $D152Stream_Cause.Cause<E>) => $D152Stream_Effect.Effect<X, never, R2>): $D152Stream_Stream<A, E, R | R2>;
    "onError"<A, E, R, X, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, cleanup: (cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<X, never, R2>): $D152Effect_Effect<A, E, R2 | R>;
}
interface $D152Method_onErrorIf {
    "onErrorIf"<A, E, R, XE, XR>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, predicate: $D152Effect_Predicate.Predicate<$D152Effect_Cause.Cause<E>>, f: (cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<void, XE, XR>): $D152Effect_Effect<A, E | XE, R | XR>;
}
interface $D152Method_onErrorFilter {
    "onErrorFilter"<A, E, R, EB, X, XE, XR>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, filter: $D152Effect_Filter.Filter<$D152Effect_Cause.Cause<E>, EB, X>, f: (failure: EB, cause: $D152Effect_Cause.Cause<E>) => $D152Effect_Effect<void, XE, XR>): $D152Effect_Effect<A, E | XE, R | XR>;
}
interface $D152Method_onExitPrimitive {
    "onExitPrimitive"<A, E, R, XE = never, XR = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (exit: $D152Effect_Exit.Exit<A, E>) => $D152Effect_Effect<void, XE, XR> | undefined, interruptible?: boolean): $D152Effect_Effect<A, E | XE, R | XR>;
}
interface $D152Method_onExit {
    "onExit"<A, In, L, E, R, X, E2, R2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (exit: $D152Sink_Exit.Exit<A, E>) => $D152Sink_Effect.Effect<X, E2, R2>): $D152Sink_Sink<A, In, L, E | E2, R | R2>;
    "onExit"<A, E, R, R2>(this: $D152Stream_Stream<A, E, R>, finalizer: (exit: $D152Stream_Exit.Exit<unknown, E>) => $D152Stream_Effect.Effect<unknown, never, R2>): $D152Stream_Stream<A, E, R | R2>;
    "onExit"<A, E, R, XE = never, XR = never>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (exit: $D152Effect_Exit.Exit<A, E>) => $D152Effect_Effect<void, XE, XR>): $D152Effect_Effect<A, E | XE, R | XR>;
}
interface $D152Method_onExitIf {
    "onExitIf"<A, E, R, XE, XR>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, predicate: $D152Effect_Predicate.Predicate<$D152Effect_Exit.Exit<$D152Effect_NoInfer<A>, $D152Effect_NoInfer<E>>>, f: (exit: $D152Effect_Exit.Exit<$D152Effect_NoInfer<A>, $D152Effect_NoInfer<E>>) => $D152Effect_Effect<void, XE, XR>): $D152Effect_Effect<A, E | XE, R | XR>;
}
interface $D152Method_onExitFilter {
    "onExitFilter"<A, E, R, XE, XR, B, X>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, filter: $D152Effect_Filter.Filter<$D152Effect_Exit.Exit<$D152Effect_NoInfer<A>, $D152Effect_NoInfer<E>>, B, X>, f: (b: B, exit: $D152Effect_Exit.Exit<$D152Effect_NoInfer<A>, $D152Effect_NoInfer<E>>) => $D152Effect_Effect<void, XE, XR>): $D152Effect_Effect<A, E | XE, R | XR>;
}
interface $D152Method_cached {
    "cached"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<$D152Effect_Effect<A, E, R>>;
}
interface $D152Method_cachedWithTTL {
    "cachedWithTTL"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, timeToLive: $D152Effect_Duration.Input | ((exit: $D152Effect_Exit.Exit<A, E>) => $D152Effect_Duration.Input)): $D152Effect_Effect<$D152Effect_Effect<A, E, R>>;
}
interface $D152Method_cachedInvalidateWithTTL {
    "cachedInvalidateWithTTL"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, timeToLive: $D152Effect_Duration.Input | ((exit: $D152Effect_Exit.Exit<A, E>) => $D152Effect_Duration.Input)): $D152Effect_Effect<[
    $D152Effect_Effect<A, E, R>,
    $D152Effect_Effect<void>
]>;
}
interface $D152Method_interruptible {
    "interruptible"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_onInterrupt {
    "onInterrupt"<A, E, R, XE, XR>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, finalizer: (interruptors: ReadonlySet<number>) => $D152Effect_Effect<void, XE, XR>): $D152Effect_Effect<A, E | XE, R | XR>;
}
interface $D152Method_uninterruptible {
    "uninterruptible"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_forever {
    "forever"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<A, E, R>;
    "forever"<Arg extends $D152Effect_Effect<any, any, any> | {
    readonly disableYield?: boolean | undefined;
} | undefined = {
    readonly disableYield?: boolean | undefined;
}>(this: (Arg) & $D152EffectReceiver, options?: {
    readonly disableYield?: boolean | undefined;
} | undefined): [
    Arg
] extends [
    $D152Effect_Effect<infer _A, infer _E, infer _R>
] ? $D152Effect_Effect<never, _E, _R> : <A, E, R>(self: $D152Effect_Effect<A, E, R>) => $D152Effect_Effect<never, E, R>;
}
interface $D152Method_repeat {
    "repeat"<A, E, R, B, E2, R2>(this: $D152Stream_Stream<A, E, R>, schedule: $D152Stream_Schedule.Schedule<B, void, E2, R2> | (($: <SO, SE, SR>(_: $D152Stream_Schedule.Schedule<SO, void, SE, SR>) => $D152Stream_Schedule.Schedule<SO, void, SE, SR>) => $D152Stream_Schedule.Schedule<B, void, E2, R2>)): $D152Stream_Stream<A, E | E2, R | R2>;
    "repeat"<A, E, R, O extends $D152Effect_Repeat.Options<A>>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: O): $D152Effect_Repeat.Return<R, E, A, O>;
    "repeat"<Input, E, R, Output, Error, Env>(this: ($D152Effect_Effect<Input, E, R>) & $D152EffectReceiver, schedule: $D152Effect_Schedule<Output, $D152Effect_NoInfer<Input>, Error, Env>): $D152Effect_Effect<Output, E | Error, R | Env>;
    "repeat"<Input, E, R, Output, Error, Env>(this: ($D152Effect_Effect<Input, E, R>) & $D152EffectReceiver, builder: ($: <O, E, R>(_: $D152Effect_Schedule<O, $D152Effect_NoInfer<Input>, E, R>) => $D152Effect_Schedule<O, Input, E, R>) => $D152Effect_Schedule<Output, $D152Effect_NoInfer<Input>, Error, Env>): $D152Effect_Effect<Output, E | Error, R | Env>;
}
interface $D152Method_repeatOrElse {
    "repeatOrElse"<A, E, R, R2, B, E2, E3, R3>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, schedule: $D152Effect_Schedule<B, A, E2, R2>, orElse: (error: E | E2, option: $D152Effect_Option<$D152Effect_ScheduleMetadata<B, A>>) => $D152Effect_Effect<B, E3, R3>): $D152Effect_Effect<B, E3, R | R2 | R3>;
}
interface $D152Method_replicate {
    "replicate"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, n: number): Array<$D152Effect_Effect<A, E, R>>;
}
interface $D152Method_replicateEffect {
    "replicateEffect"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, n: number, options?: {
    readonly concurrency?: $D152Effect_Concurrency | undefined;
    readonly discard?: false | undefined;
}): $D152Effect_Effect<Array<A>, E, R>;
    "replicateEffect"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, n: number, options: {
    readonly concurrency?: $D152Effect_Concurrency | undefined;
    readonly discard: true;
}): $D152Effect_Effect<void, E, R>;
}
interface $D152Method_schedule {
    "schedule"<A, E, R, X, E2, R2>(this: $D152Stream_Stream<A, E, R>, schedule: $D152Stream_Schedule.Schedule<X, $D152Stream_NoInfer<A>, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
    "schedule"<A, E, R, Output, Error, Env>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, schedule: $D152Effect_Schedule<Output, unknown, Error, Env>): $D152Effect_Effect<Output, E | Error, R | Env>;
}
interface $D152Method_scheduleFrom {
    "scheduleFrom"<Input, E, R, Output, Error, Env>(this: ($D152Effect_Effect<Input, E, R>) & $D152EffectReceiver, initial: Input, schedule: $D152Effect_Schedule<Output, Input, Error, Env>): $D152Effect_Effect<Output, E | Error, R | Env>;
}
interface $D152Method_withTracer {
    "withTracer"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, value: $D152Effect_Tracer): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_withTracerEnabled {
    "withTracerEnabled"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, enabled: boolean): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_withTracerTiming {
    "withTracerTiming"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, enabled: boolean): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_annotateSpans {
    "annotateSpans"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, key: string, value: unknown): $D152Effect_Effect<A, E, R>;
    "annotateSpans"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, values: Record<string, unknown>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_linkSpans {
    "linkSpans"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, span: $D152Effect_AnySpan | ReadonlyArray<$D152Effect_AnySpan>, attributes?: Record<string, unknown>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_withSpan {
    "withSpan"<A, E, R>(this: $D152Stream_Stream<A, E, R>, name: string, options?: $D152Stream_SpanOptions): $D152Stream_Stream<A, E, Exclude<R, $D152Stream_ParentSpan>>;
    "withSpan"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, name: string, options?: $D152Effect_SpanOptions | undefined): $D152Effect_Effect<A, E, Exclude<R, $D152Effect_ParentSpan>>;
}
interface $D152Method_withSpanScoped {
    "withSpanScoped"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, name: string, options?: $D152Effect_SpanOptions): $D152Effect_Effect<A, E, Exclude<R, $D152Effect_ParentSpan> | $D152Effect_Scope>;
}
interface $D152Method_withParentSpan {
    "withParentSpan"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, value: $D152Effect_AnySpan, options?: $D152Effect_TraceOptions): $D152Effect_Effect<A, E, Exclude<R, $D152Effect_ParentSpan>>;
}
interface $D152Method_request {
    "request"<A extends $D152Effect_Request.Any, EX = never, RX = never>(this: (A) & $D152EffectReceiver, resolver: $D152Effect_RequestResolver<A> | $D152Effect_Effect<$D152Effect_RequestResolver<A>, EX, RX>): $D152Effect_Effect<$D152Effect_Request.Success<A>, $D152Effect_Request.Error<A> | EX, $D152Effect_Request.Services<A> | RX>;
}
interface $D152Method_requestUnsafe {
    "requestUnsafe"<A extends $D152Effect_Request.Any>(this: (A) & $D152EffectReceiver, options: {
    readonly resolver: $D152Effect_RequestResolver<A>;
    readonly onExit: (exit: $D152Effect_Exit.Exit<$D152Effect_Request.Success<A>, $D152Effect_Request.Error<A>>) => void;
    readonly context: $D152Effect_Context.Context<never>;
}): () => void;
}
interface $D152Method_forkChild {
    "forkChild"<Arg extends $D152Effect_Effect<any, any, any> | {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
} | undefined = {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
}>(this: (Arg) & $D152EffectReceiver, options?: {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
} | undefined): [
    Arg
] extends [
    $D152Effect_Effect<infer _A, infer _E, infer _R>
] ? $D152Effect_Effect<$D152Effect_Fiber<_A, _E>, never, _R> : <A, E, R>(self: $D152Effect_Effect<A, E, R>) => $D152Effect_Effect<$D152Effect_Fiber<A, E>, never, R>;
}
interface $D152Method_forkIn {
    "forkIn"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, scope: $D152Effect_Scope, options?: {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
}): $D152Effect_Effect<$D152Effect_Fiber<A, E>, never, R>;
}
interface $D152Method_forkScoped {
    "forkScoped"<Arg extends $D152Effect_Effect<any, any, any> | {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
} | undefined = {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
}>(this: (Arg) & $D152EffectReceiver, options?: {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
} | undefined): [
    Arg
] extends [
    $D152Effect_Effect<infer _A, infer _E, infer _R>
] ? $D152Effect_Effect<$D152Effect_Fiber<_A, _E>, never, _R | $D152Effect_Scope> : <A, E, R>(self: $D152Effect_Effect<A, E, R>) => $D152Effect_Effect<$D152Effect_Fiber<A, E>, never, R | $D152Effect_Scope>;
}
interface $D152Method_forkDetach {
    "forkDetach"<Arg extends $D152Effect_Effect<any, any, any> | {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
} | undefined = {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
}>(this: (Arg) & $D152EffectReceiver, options?: {
    readonly startImmediately?: boolean | undefined;
    readonly uninterruptible?: boolean | "inherit" | undefined;
} | undefined): [
    Arg
] extends [
    $D152Effect_Effect<infer _A, infer _E, infer _R>
] ? $D152Effect_Effect<$D152Effect_Fiber<_A, _E>, never, _R> : <A, E, R>(self: $D152Effect_Effect<A, E, R>) => $D152Effect_Effect<$D152Effect_Fiber<A, E>, never, R>;
}
interface $D152Method_awaitAllChildren {
    "awaitAllChildren"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_withLogger {
    "withLogger"<A, E, R, Output>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, logger: $D152Effect_Logger<unknown, Output>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_annotateLogs {
    "annotateLogs"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, key: string, value: unknown): $D152Effect_Effect<A, E, R>;
    "annotateLogs"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, values: Record<string, unknown>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_withLogSpan {
    "withLogSpan"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, label: string): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_track {
    "track"<A, E, R, Input, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<Input, State>, f: (exit: $D152Effect_Exit.Exit<A, E>) => Input): $D152Effect_Effect<A, E, R>;
    "track"<A, E, R, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<$D152Effect_Exit.Exit<$D152Effect_NoInfer<A>, $D152Effect_NoInfer<E>>, State>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_trackSuccesses {
    "trackSuccesses"<A, E, R, Input, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<Input, State>, f: (value: A) => Input): $D152Effect_Effect<A, E, R>;
    "trackSuccesses"<A, E, R, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<$D152Effect_NoInfer<A>, State>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_trackErrors {
    "trackErrors"<A, E, R, Input, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<Input, State>, f: (error: E) => Input): $D152Effect_Effect<A, E, R>;
    "trackErrors"<A, E, R, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<$D152Effect_NoInfer<E>, State>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_trackDefects {
    "trackDefects"<A, E, R, Input, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<Input, State>, f: (defect: unknown) => Input): $D152Effect_Effect<A, E, R>;
    "trackDefects"<A, E, R, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<unknown, State>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_trackDuration {
    "trackDuration"<A, E, R, Input, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<Input, State>, f: (duration: $D152Effect_Duration.Duration) => Input): $D152Effect_Effect<A, E, R>;
    "trackDuration"<A, E, R, State>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, metric: $D152Effect_Metric.Metric<$D152Effect_Duration.Duration, State>): $D152Effect_Effect<A, E, R>;
}
interface $D152Method_tx {
    "tx"<A, E, R>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver): $D152Effect_Effect<A, E, Exclude<R, $D152Effect_Transaction>>;
}
interface $D152Method_mapEager {
    "mapEager"<A, E, R, B>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (a: A) => B): $D152Effect_Effect<B, E, R>;
}
interface $D152Method_mapErrorEager {
    "mapErrorEager"<A, E, R, E2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (e: E) => E2): $D152Effect_Effect<A, E2, R>;
}
interface $D152Method_mapBothEager {
    "mapBothEager"<A, E, R, E2, A2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, options: {
    readonly onFailure: (e: E) => E2;
    readonly onSuccess: (a: A) => A2;
}): $D152Effect_Effect<A2, E2, R>;
}
interface $D152Method_flatMapEager {
    "flatMapEager"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (a: A) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<B, E | E2, R | R2>;
}
interface $D152Method_catchEager {
    "catchEager"<A, E, R, B, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (e: $D152Effect_NoInfer<E>) => $D152Effect_Effect<B, E2, R2>): $D152Effect_Effect<A | B, E2, R | R2>;
}
interface $D152Method_let {
    "let"<A extends object, N extends string, B>(this: $D152Option_Option<A>, name: Exclude<N, keyof A>, f: (a: $D152Option_NoInfer<A>) => B): $D152Option_Option<{
    [K in N | keyof A]: K extends keyof A ? A[K] : B;
}>;
    "let"<R extends object, L, N extends string, B>(this: $D152Result_Result<R, L>, name: Exclude<N, keyof R>, f: (r: $D152Result_NoInfer<R>) => B): $D152Result_Result<{
    [K in N | keyof R]: K extends keyof R ? R[K] : B;
}, L>;
    "let"<A extends Record<string, any>, E, R, B, N extends string>(this: $D152Stream_Stream<A, E, R>, name: N, f: (a: $D152Stream_NoInfer<A>) => B): $D152Stream_Stream<$D152Stream_Simplify<Omit<A, N> & Record<N, B>>, E, R>;
    "let"<A extends Record<string, any>, E, R, B, N extends string>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, name: N, f: (a: $D152Effect_NoInfer<A>) => B): $D152Effect_Effect<$D152Effect_Simplify<Omit<A, N> & Record<N, B>>, E, R>;
}
interface $D152Method_catch {
    "catch"<A, In, L, E, R, A2, E2, R2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (error: E) => $D152Sink_Effect.Effect<A2, E2, R2>): $D152Sink_Sink<A | A2, In, L, E2, R | R2>;
    "catch"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (error: E) => $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<A | A2, E2, R | R2>;
    "catch"<A, E, R, A2, E2, R2>(this: ($D152Effect_Effect<A, E, R>) & $D152EffectReceiver, f: (e: E) => $D152Effect_Effect<A2, E2, R2>): $D152Effect_Effect<A2 | A, E2, R2 | R>;
}
interface $D152Method_filterSuccess {
    "filterSuccess"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Result.Result<$D152Exit_Success<A>, $D152Exit_Failure<never, E>>;
}
interface $D152Method_filterValue {
    "filterValue"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Result.Result<A, $D152Exit_Failure<never, E>>;
}
interface $D152Method_filterFailure {
    "filterFailure"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Result.Result<$D152Exit_Failure<never, E>, $D152Exit_Success<A>>;
}
interface $D152Method_filterCause {
    "filterCause"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Result.Result<$D152Exit_Cause.Cause<E>, $D152Exit_Success<A>>;
}
interface $D152Method_getSuccess {
    "getSuccess"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Option<A>;
    "getSuccess"<A, E>(this: $D152Option_Result<A, E>): $D152Option_Option<A>;
    "getSuccess"<A, E>(this: $D152Result_Result<A, E>): $D152Result_Option<A>;
}
interface $D152Method_getCause {
    "getCause"<A, E>(this: $D152Exit_Exit<A, E>): $D152Exit_Option<$D152Exit_Cause.Cause<E>>;
}
interface $D152Method_awaitAll {
    "awaitAll"<A extends $D152Fiber_Fiber<any, any>>(this: Iterable<A>): $D152Fiber_Effect<Array<$D152Fiber_Exit<A extends $D152Fiber_Fiber<infer _A, infer _E> ? _A : never, A extends $D152Fiber_Fiber<infer _A, infer _E> ? _E : never>>>;
}
interface $D152Method_joinAll {
    "joinAll"<A extends Iterable<$D152Fiber_Fiber<any, any>>>(this: A): $D152Fiber_Effect<$D152Fiber_Arr.ReadonlyArray.With<A, A extends Iterable<$D152Fiber_Fiber<infer _A, infer _E>> ? _A : never>, A extends Iterable<$D152Fiber_Fiber<infer _A, infer _E>> ? _E : never>;
}
interface $D152Method_interruptAs {
    "interruptAs"<A, E>(this: $D152Fiber_Fiber<A, E>, fiberId: number | undefined, annotations?: $D152Fiber_Context.Context<never> | undefined): $D152Fiber_Effect<void>;
}
interface $D152Method_runIn {
    "runIn"<A, E>(this: $D152Fiber_Fiber<A, E>, scope: $D152Fiber_Scope): $D152Fiber_Fiber<A, E>;
}
interface $D152Method_getHash {
    "getHash"<K1 extends K, K, V>(this: $D152HashMap_HashMap<K, V>, key: K1, hash: number): $D152HashMap_Option<V>;
}
interface $D152Method_has {
    "has"<K1 extends K, K, V>(this: $D152HashMap_HashMap<K, V>, key: K1): boolean;
    "has"<V>(this: $D152HashSet_HashSet<V>, value: V): boolean;
}
interface $D152Method_hasHash {
    "hasHash"<K1 extends K, K, V>(this: $D152HashMap_HashMap<K, V>, key: K1, hash: number): boolean;
}
interface $D152Method_hasBy {
    "hasBy"<K, V>(this: $D152HashMap_HashMap<K, V>, predicate: (value: $D152HashMap_NoInfer<V>, key: $D152HashMap_NoInfer<K>) => boolean): boolean;
}
interface $D152Method_set {
    "set"<K, V>(this: $D152HashMap_HashMap<K, V>, key: K, value: V): $D152HashMap_HashMap<K, V>;
    "set"<A>(this: $D152Ref_Ref<A>, value: A): $D152Ref_Effect.Effect<void>;
}
interface $D152Method_keys {
    "keys"<K, V>(this: $D152HashMap_HashMap<K, V>): IterableIterator<K>;
}
interface $D152Method_values {
    "values"<K, V>(this: $D152HashMap_HashMap<K, V>): IterableIterator<V>;
}
interface $D152Method_toValues {
    "toValues"<K, V>(this: $D152HashMap_HashMap<K, V>): Array<V>;
}
interface $D152Method_entries {
    "entries"<K, V>(this: $D152HashMap_HashMap<K, V>): IterableIterator<[
    K,
    V
]>;
}
interface $D152Method_toEntries {
    "toEntries"<K, V>(this: $D152HashMap_HashMap<K, V>): Array<[
    K,
    V
]>;
}
interface $D152Method_beginMutation {
    "beginMutation"<K, V>(this: $D152HashMap_HashMap<K, V>): $D152HashMap_HashMap<K, V>;
}
interface $D152Method_endMutation {
    "endMutation"<K, V>(this: $D152HashMap_HashMap<K, V>): $D152HashMap_HashMap<K, V>;
}
interface $D152Method_modifyAt {
    "modifyAt"<K, V>(this: $D152HashMap_HashMap<K, V>, key: K, f: $D152HashMap_HashMap.UpdateFn<V>): $D152HashMap_HashMap<K, V>;
}
interface $D152Method_modifyHash {
    "modifyHash"<K, V>(this: $D152HashMap_HashMap<K, V>, key: K, hash: number, f: $D152HashMap_HashMap.UpdateFn<V>): $D152HashMap_HashMap<K, V>;
}
interface $D152Method_removeMany {
    "removeMany"<K, V>(this: $D152HashMap_HashMap<K, V>, keys: Iterable<K>): $D152HashMap_HashMap<K, V>;
}
interface $D152Method_setMany {
    "setMany"<K, V>(this: $D152HashMap_HashMap<K, V>, entries: Iterable<readonly [
    K,
    V
]>): $D152HashMap_HashMap<K, V>;
}
interface $D152Method_isSubset {
    "isSubset"<V0, V1>(this: $D152HashSet_HashSet<V0>, that: $D152HashSet_HashSet<V1>): boolean;
}
interface $D152Method_isNone {
    "isNone"<A>(this: $D152Option_Option<A>): this is $D152Option_None<A>;
}
interface $D152Method_isSome {
    "isSome"<A>(this: $D152Option_Option<A>): this is $D152Option_Some<A>;
}
interface $D152Method_getFailure {
    "getFailure"<A, E>(this: $D152Option_Result<A, E>): $D152Option_Option<E>;
    "getFailure"<A, E>(this: $D152Result_Result<A, E>): $D152Result_Option<E>;
}
interface $D152Method_getOrElse {
    "getOrElse"<A, B>(this: $D152Option_Option<A>, onNone: $D152Option_LazyArg<B>): A | B;
    "getOrElse"<A, E, A2>(this: $D152Result_Result<A, E>, onFailure: (err: E) => A2): A | A2;
}
interface $D152Method_orElse {
    "orElse"<A, B>(this: $D152Option_Option<A>, that: $D152Option_LazyArg<$D152Option_Option<B>>): $D152Option_Option<A | B>;
    "orElse"<A, E, A2, E2>(this: $D152Result_Result<A, E>, that: (err: E) => $D152Result_Result<A2, E2>): $D152Result_Result<A | A2, E2>;
    "orElse"<A, In, L, E, R, A2, In2, L2, E2, R2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (error: E) => $D152Sink_Sink<A2, In2, L2, E2, R2>): $D152Sink_Sink<A | A2, In & In2, L | L2, E | E2, R | R2>;
}
interface $D152Method_orElseSome {
    "orElseSome"<A, B>(this: $D152Option_Option<A>, onNone: $D152Option_LazyArg<B>): $D152Option_Option<A | B>;
}
interface $D152Method_orElseResult {
    "orElseResult"<A, B>(this: $D152Option_Option<A>, that: $D152Option_LazyArg<$D152Option_Option<B>>): $D152Option_Option<$D152Option_Result<B, A>>;
}
interface $D152Method_getOrNull {
    "getOrNull"<A>(this: $D152Option_Option<A>): A | null;
    "getOrNull"<A, E>(this: $D152Result_Result<A, E>): A | null;
}
interface $D152Method_getOrUndefined {
    "getOrUndefined"<A>(this: $D152Option_Option<A>): A | undefined;
    "getOrUndefined"<A, E>(this: $D152Result_Result<A, E>): A | undefined;
}
interface $D152Method_getOrThrowWith {
    "getOrThrowWith"<A>(this: $D152Option_Option<A>, onNone: () => unknown): A;
    "getOrThrowWith"<A, E>(this: $D152Result_Result<A, E>, onFailure: (err: E) => unknown): A;
}
interface $D152Method_getOrThrow {
    "getOrThrow"<A>(this: $D152Option_Option<A>): A;
    "getOrThrow"<A, E>(this: $D152Result_Result<A, E>): A;
}
interface $D152Method_flatMapNullishOr {
    "flatMapNullishOr"<A, B>(this: $D152Option_Option<A>, f: (a: A) => B): $D152Option_Option<NonNullable<B>>;
}
interface $D152Method_zipRight {
    "zipRight"<X, B>(this: $D152Option_Option<X>, that: $D152Option_Option<B>): $D152Option_Option<B>;
    "zipRight"<AL, EL, RL, AR, ER, RR>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>): $D152Stream_Stream<AR, EL | ER, RL | RR>;
}
interface $D152Method_zipLeft {
    "zipLeft"<A, X>(this: $D152Option_Option<A>, that: $D152Option_Option<X>): $D152Option_Option<A>;
    "zipLeft"<AL, EL, RL, AR, ER, RR>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>): $D152Stream_Stream<AL, EL | ER, RL | RR>;
}
interface $D152Method_product {
    "product"<A, B>(this: $D152Option_Option<A>, that: $D152Option_Option<B>): $D152Option_Option<[
    A,
    B
]>;
}
interface $D152Method_productMany {
    "productMany"<A>(this: $D152Option_Option<A>, collection: Iterable<$D152Option_Option<A>>): $D152Option_Option<[
    A,
    ...Array<A>
]>;
}
interface $D152Method_reduceCompact {
    "reduceCompact"<A, B>(this: Iterable<$D152Option_Option<A>>, b: B, f: (b: B, a: A) => B): B;
}
interface $D152Method_partitionMap {
    "partitionMap"<A, B, C>(this: $D152Option_Option<A>, f: (a: A) => $D152Option_Result<C, B>): [
    passes: $D152Option_Option<C>,
    fails: $D152Option_Option<B>
];
}
interface $D152Method_liftPredicate {
    "liftPredicate"<A, B extends A>(this: A, refinement: $D152Option_Refinement<A, B>): $D152Option_Option<B>;
    "liftPredicate"<B extends A, A = B>(this: B, predicate: $D152Option_Predicate<A>): $D152Option_Option<B>;
    "liftPredicate"<A, E, B extends A>(this: A, refinement: $D152Result_Refinement<A, B>, orFailWith: (a: A) => E): $D152Result_Result<B, E>;
    "liftPredicate"<B extends A, E, A = B>(this: B, predicate: $D152Result_Predicate<A>, orFailWith: (a: A) => E): $D152Result_Result<B, E>;
}
interface $D152Method_exists {
    "exists"<A, B extends A>(this: $D152Option_Option<A>, refinement: $D152Option_Refinement<A, B>): this is $D152Option_Option<B>;
    "exists"<A>(this: $D152Option_Option<A>, predicate: $D152Option_Predicate<A>): boolean;
}
interface $D152Method_asEnqueue {
    "asEnqueue"<A, E>(this: $D152Queue_Queue<A, E>): $D152Queue_Enqueue<A, E>;
}
interface $D152Method_asDequeue {
    "asDequeue"<A, E>(this: $D152Queue_Queue<A, E>): $D152Queue_Dequeue<A, E>;
}
interface $D152Method_offer {
    "offer"<A, E>(this: $D152Queue_Enqueue<A, E>, message: $D152Queue_Types.NoInfer<A>): $D152Queue_Effect<boolean>;
}
interface $D152Method_offerUnsafe {
    "offerUnsafe"<A, E>(this: $D152Queue_Enqueue<A, E>, message: $D152Queue_Types.NoInfer<A>): boolean;
}
interface $D152Method_offerAll {
    "offerAll"<A, E>(this: $D152Queue_Enqueue<A, E>, messages: Iterable<A>): $D152Queue_Effect<Array<A>>;
}
interface $D152Method_offerAllUnsafe {
    "offerAllUnsafe"<A, E>(this: $D152Queue_Enqueue<A, E>, messages: Iterable<A>): Array<A>;
}
interface $D152Method_failCauseUnsafe {
    "failCauseUnsafe"<A, E>(this: $D152Queue_Enqueue<A, E>, cause: $D152Queue_Cause<E>): boolean;
}
interface $D152Method_end {
    "end"<A, E>(this: $D152Queue_Enqueue<A, E | $D152Queue_Done>): $D152Queue_Effect<boolean>;
}
interface $D152Method_endUnsafe {
    "endUnsafe"<A, E>(this: $D152Queue_Enqueue<A, E | $D152Queue_Done>): boolean;
}
interface $D152Method_shutdown {
    "shutdown"<A, E>(this: $D152Queue_Enqueue<A, E>): $D152Queue_Effect<boolean>;
}
interface $D152Method_shutdownUnsafe {
    "shutdownUnsafe"<A, E>(this: $D152Queue_Enqueue<A, E>): boolean;
}
interface $D152Method_clear {
    "clear"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Effect<Array<A>, $D152Queue_Pull.ExcludeDone<E>>;
}
interface $D152Method_takeAll {
    "takeAll"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Effect<$D152Queue_Arr.NonEmptyArray<A>, E>;
}
interface $D152Method_collect {
    "collect"<A, E>(this: $D152Queue_Dequeue<A, E | $D152Queue_Done>): $D152Queue_Effect<Array<A>, $D152Queue_Pull.ExcludeDone<E>>;
    "collect"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<Array<A>, E, R>;
}
interface $D152Method_takeN {
    "takeN"<A, E>(this: $D152Queue_Dequeue<A, E>, n: number): $D152Queue_Effect<Array<A>, E>;
}
interface $D152Method_takeBetween {
    "takeBetween"<A, E>(this: $D152Queue_Dequeue<A, E>, min: number, max: number): $D152Queue_Effect<Array<A>, E>;
}
interface $D152Method_peek {
    "peek"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Effect<A, E>;
}
interface $D152Method_takeUnsafe {
    "takeUnsafe"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Exit<A, E> | undefined;
}
interface $D152Method_flushUnsafe {
    "flushUnsafe"<A, E>(this: $D152Queue_Enqueue<A, E>): void;
}
interface $D152Method_flush {
    "flush"<A, E>(this: $D152Queue_Enqueue<A, E>): $D152Queue_Effect<void>;
}
interface $D152Method_isFull {
    "isFull"<A, E>(this: $D152Queue_Dequeue<A, E>): $D152Queue_Effect<boolean>;
}
interface $D152Method_sizeUnsafe {
    "sizeUnsafe"<A, E>(this: $D152Queue_Dequeue<A, E>): number;
}
interface $D152Method_isFullUnsafe {
    "isFullUnsafe"<A, E>(this: $D152Queue_Dequeue<A, E>): boolean;
}
interface $D152Method_getAndSet {
    "getAndSet"<A>(this: $D152Ref_Ref<A>, value: A): $D152Ref_Effect.Effect<A>;
}
interface $D152Method_getAndUpdate {
    "getAndUpdate"<A>(this: $D152Ref_Ref<A>, f: (a: A) => A): $D152Ref_Effect.Effect<A>;
}
interface $D152Method_getAndUpdateSome {
    "getAndUpdateSome"<A>(this: $D152Ref_Ref<A>, pf: (a: A) => $D152Ref_Option.Option<A>): $D152Ref_Effect.Effect<A>;
}
interface $D152Method_setAndGet {
    "setAndGet"<A>(this: $D152Ref_Ref<A>, value: A): $D152Ref_Effect.Effect<A>;
}
interface $D152Method_modifySome {
    "modifySome"<A, B>(this: $D152Ref_Ref<A>, pf: (a: A) => readonly [
    B,
    $D152Ref_Option.Option<A>
]): $D152Ref_Effect.Effect<B>;
}
interface $D152Method_update {
    "update"<A>(this: $D152Ref_Ref<A>, f: (a: A) => A): $D152Ref_Effect.Effect<void>;
}
interface $D152Method_updateAndGet {
    "updateAndGet"<A>(this: $D152Ref_Ref<A>, f: (a: A) => A): $D152Ref_Effect.Effect<A>;
}
interface $D152Method_updateSome {
    "updateSome"<A>(this: $D152Ref_Ref<A>, f: (a: A) => $D152Ref_Option.Option<A>): $D152Ref_Effect.Effect<void>;
}
interface $D152Method_updateSomeAndGet {
    "updateSomeAndGet"<A>(this: $D152Ref_Ref<A>, pf: (a: A) => $D152Ref_Option.Option<A>): $D152Ref_Effect.Effect<A>;
}
interface $D152Method_fromNullishOr {
    "fromNullishOr"<A, E>(this: A, onNullish: (a: A) => E): $D152Result_Result<NonNullable<A>, E>;
}
interface $D152Method_fromOption {
    "fromOption"<A, E>(this: $D152Result_Option<A>, onNone: () => E): $D152Result_Result<A, E>;
}
interface $D152Method_merge {
    "merge"<A, E>(this: $D152Result_Result<A, E>): E | A;
    "merge"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>, options?: {
    readonly haltStrategy?: $D152Stream_HaltStrategy | undefined;
} | undefined): $D152Stream_Stream<A | A2, E | E2, R | R2>;
}
interface $D152Method_transposeMapOption {
    "transposeMapOption"<A, B, E = never>(this: $D152Result_Option<A>, f: (self: A) => $D152Result_Result<B, E>): $D152Result_Result<$D152Result_Option<B>, E>;
}
interface $D152Method_toStep {
    "toStep"<Output, Input, Error, Env>(this: $D152Schedule_Schedule<Output, Input, Error, Env>): $D152Schedule_Effect<(now: number, input: Input) => $D152Schedule_Pull.Pull<[
    Output,
    $D152Schedule_Duration.Duration
], Error, Output, Env>, never, Env>;
}
interface $D152Method_toStepWithMetadata {
    "toStepWithMetadata"<Output, Input, Error, Env>(this: $D152Schedule_Schedule<Output, Input, Error, Env>): $D152Schedule_Effect<(input: Input) => $D152Schedule_Pull.Pull<$D152Schedule_Metadata<Output, Input>, Error, Output, Env>, never, Env>;
}
interface $D152Method_toStepWithSleep {
    "toStepWithSleep"<Output, Input, Error, Env>(this: $D152Schedule_Schedule<Output, Input, Error, Env>): $D152Schedule_Effect<(input: Input) => $D152Schedule_Pull.Pull<Output, Error, Output, Env>, never, Env>;
}
interface $D152Method_addDelay {
    "addDelay"<Output, Input, Error, Env, Error2 = never, Env2 = never>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, f: (metadata: $D152Schedule_Metadata<Output, Input>) => $D152Schedule_Effect<$D152Schedule_Duration.Input, Error2, Env2>): $D152Schedule_Schedule<Output, Input, Error | Error2, Env | Env2>;
}
interface $D152Method_concat {
    "concat"<Output, Input, Error, Env, Output2, Input2, Error2, Env2>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, other: $D152Schedule_Schedule<Output2, Input2, Error2, Env2>): $D152Schedule_Schedule<Output | Output2, Input & Input2, Error | Error2, Env | Env2>;
    "concat"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<A | A2, E | E2, R | R2>;
}
interface $D152Method_concatResult {
    "concatResult"<Output, Input, Error, Env, Output2, Input2, Error2, Env2>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, other: $D152Schedule_Schedule<Output2, Input2, Error2, Env2>): $D152Schedule_Schedule<$D152Schedule_Result.Result<Output2, Output>, Input & Input2, Error | Error2, Env | Env2>;
}
interface $D152Method_modifyDelay {
    "modifyDelay"<Output, Input, Error, Env, Error2 = never, Env2 = never>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, f: (metadata: $D152Schedule_Metadata<Output, Input>) => $D152Schedule_Effect<$D152Schedule_Duration.Input, Error2, Env2>): $D152Schedule_Schedule<Output, Input, Error | Error2, Env | Env2>;
}
interface $D152Method_jittered {
    "jittered"<Output, Input, Error, Env>(this: $D152Schedule_Schedule<Output, Input, Error, Env>): $D152Schedule_Schedule<Output, Input, Error, Env>;
}
interface $D152Method_passthrough {
    "passthrough"<Output, Input, Error, Env>(this: $D152Schedule_Schedule<Output, Input, Error, Env>): $D152Schedule_Schedule<Input, Input, Error, Env>;
}
interface $D152Method_upTo {
    "upTo"<Output, Input, Error, Env>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, options: {
    readonly duration?: $D152Schedule_Duration.Input | undefined;
    readonly times?: number | undefined;
}): $D152Schedule_Schedule<Output, Input, Error, Env>;
}
interface $D152Method_while {
    "while"<Output, Input, Error, Env, Meta extends $D152Schedule_Metadata<Output, Input>>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, predicate: (metadata: $D152Schedule_Metadata<Output, Input>) => metadata is Meta): $D152Schedule_Schedule<Meta["output"], Meta["input"], Error, Env>;
    "while"<Output, Input, Error, Env, Error2 = never, Env2 = never>(this: $D152Schedule_Schedule<Output, Input, Error, Env>, predicate: (metadata: $D152Schedule_Metadata<Output, Input>) => boolean | $D152Schedule_Effect<boolean, Error2, Env2>): $D152Schedule_Schedule<Output, Input, Error | Error2, Env | Env2>;
}
interface $D152Method_toChannel {
    "toChannel"<A, In, L, E, R>(this: $D152Sink_Sink<A, In, L, E, R>): $D152Sink_Channel.Channel<never, E, $D152Sink_End<A, L>, $D152Sink_NonEmptyReadonlyArray<In>, never, void, R>;
    "toChannel"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Channel.Channel<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, void, unknown, unknown, unknown, R>;
}
interface $D152Method_ignoreLeftover {
    "ignoreLeftover"<A, In, L, E, R>(this: $D152Sink_Sink<A, In, L, E, R>): $D152Sink_Sink<A, In, never, E, R>;
}
interface $D152Method_mapInput {
    "mapInput"<A, In, L, E, R, In0>(this: $D152Sink_Sink<A, In, L, E, R>, f: (input: In0) => In): $D152Sink_Sink<A, In0, L, E, R>;
}
interface $D152Method_mapInputEffect {
    "mapInputEffect"<A, In, L, E, R, In0, E2, R2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (input: In0) => $D152Sink_Effect.Effect<In, E2, R2>): $D152Sink_Sink<A, In0, L, E | E2, R | R2>;
}
interface $D152Method_mapInputArray {
    "mapInputArray"<A, In, L, E, R, In0>(this: $D152Sink_Sink<A, In, L, E, R>, f: (input: $D152Sink_Arr.NonEmptyReadonlyArray<In0>) => $D152Sink_Arr.NonEmptyReadonlyArray<In>): $D152Sink_Sink<A, In0, L, E, R>;
}
interface $D152Method_mapInputArrayEffect {
    "mapInputArrayEffect"<A, In, L, E, R, In0, E2, R2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (input: $D152Sink_Arr.NonEmptyReadonlyArray<In0>) => $D152Sink_Effect.Effect<$D152Sink_Arr.NonEmptyReadonlyArray<In>, E2, R2>): $D152Sink_Sink<A, In0, L, E | E2, R | R2>;
}
interface $D152Method_mapEnd {
    "mapEnd"<A, In, L, E, R, A2, L2 = never>(this: $D152Sink_Sink<A, In, L, E, R>, f: (a: $D152Sink_End<A, L>) => $D152Sink_End<A2, L2>): $D152Sink_Sink<A2, In, L2, E, R>;
}
interface $D152Method_mapEffectEnd {
    "mapEffectEnd"<A, In, L, E, R, A2, E2, R2, L2 = never>(this: $D152Sink_Sink<A, In, L, E, R>, f: (end: $D152Sink_End<A, L>) => $D152Sink_Effect.Effect<$D152Sink_End<A2, L2>, E2, R2>): $D152Sink_Sink<A2, In, L2, E | E2, R | R2>;
}
interface $D152Method_mapEffect {
    "mapEffect"<A, In, L, E, R, A2, E2, R2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (a: A) => $D152Sink_Effect.Effect<A2, E2, R2>): $D152Sink_Sink<A2, In, L, E | E2, R | R2>;
    "mapEffect"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: A, i: number) => $D152Stream_Effect.Effect<A2, E2, R2>, options?: {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly unordered?: boolean | undefined;
} | undefined): $D152Stream_Stream<A2, E | E2, R | R2>;
}
interface $D152Method_mapLeftover {
    "mapLeftover"<A, In, L, E, R, L2>(this: $D152Sink_Sink<A, In, L, E, R>, f: (leftover: L) => L2): $D152Sink_Sink<A, In, L2, E, R>;
}
interface $D152Method_summarized {
    "summarized"<A, In, L, E, R, A2, E2, R2, A3>(this: $D152Sink_Sink<A, In, L, E, R>, summary: $D152Sink_Effect.Effect<A2, E2, R2>, f: (start: A2, end: A2) => A3): $D152Sink_Sink<[
    A,
    A3
], In, L, E | E2, R | R2>;
}
interface $D152Method_withDuration {
    "withDuration"<A, In, L, E, R>(this: $D152Sink_Sink<A, In, L, E, R>): $D152Sink_Sink<[
    A,
    $D152Sink_Duration.Duration
], In, L, E, R>;
}
interface $D152Method_transformPull {
    "transformPull"<A, E, R, B, E2, R2, EX, RX>(this: $D152Stream_Stream<A, E, R>, f: (pull: $D152Stream_Pull.Pull<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, void>, scope: $D152Stream_Scope.Scope) => $D152Stream_Effect.Effect<$D152Stream_Pull.Pull<$D152Stream_Arr.NonEmptyReadonlyArray<B>, E2, void, R2>, EX, RX>): $D152Stream_Stream<B, EX | $D152Stream_Pull.ExcludeDone<E2>, R | R2 | RX>;
}
interface $D152Method_transformPullBracket {
    "transformPullBracket"<A, E, R, B, E2, R2, EX, RX>(this: $D152Stream_Stream<A, E, R>, f: (pull: $D152Stream_Pull.Pull<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, void, R>, scope: $D152Stream_Scope.Scope, forkedScope: $D152Stream_Scope.Scope) => $D152Stream_Effect.Effect<$D152Stream_Pull.Pull<$D152Stream_Arr.NonEmptyReadonlyArray<B>, E2, void, R2>, EX, RX>): $D152Stream_Stream<B, EX | $D152Stream_Pull.ExcludeDone<E2>, R | R2 | RX>;
}
interface $D152Method_mapArray {
    "mapArray"<A, E, R, B>(this: $D152Stream_Stream<A, E, R>, f: (a: $D152Stream_Arr.NonEmptyReadonlyArray<A>, i: number) => $D152Stream_Arr.NonEmptyReadonlyArray<B>): $D152Stream_Stream<B, E, R>;
}
interface $D152Method_flattenEffect {
    "flattenEffect"<Arg extends $D152Stream_Stream<$D152Stream_Effect.Effect<any, any, any>, any, any> | {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly unordered?: boolean | undefined;
} | undefined = {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly unordered?: boolean | undefined;
}>(this: Arg, options?: {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly unordered?: boolean | undefined;
} | undefined): [
    Arg
] extends [
    $D152Stream_Stream<$D152Stream_Effect.Effect<infer _A, infer _EX, infer _RX>, infer _E, infer _R>
] ? $D152Stream_Stream<_A, _EX | _E, _RX | _R> : <A, EX, RX, E, R>(self: $D152Stream_Stream<$D152Stream_Effect.Effect<A, EX, RX>, E, R>) => $D152Stream_Stream<A, EX | E, RX | R>;
}
interface $D152Method_mapArrayEffect {
    "mapArrayEffect"<A, E, R, B, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: $D152Stream_Arr.NonEmptyReadonlyArray<A>, i: number) => $D152Stream_Effect.Effect<$D152Stream_Arr.NonEmptyReadonlyArray<B>, E2, R2>): $D152Stream_Stream<B, E | E2, R | R2>;
}
interface $D152Method_tapBoth {
    "tapBoth"<A, E, R, X, E2, R2, Y, E3, R3>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly onElement: (a: $D152Stream_NoInfer<A>) => $D152Stream_Effect.Effect<X, E2, R2>;
    readonly onError: (a: $D152Stream_NoInfer<E>) => $D152Stream_Effect.Effect<Y, E3, R3>;
    readonly concurrency?: $D152Stream_Concurrency | undefined;
}): $D152Stream_Stream<A, E | E2 | E3, R | R2 | R3>;
}
interface $D152Method_tapSink {
    "tapSink"<A, E, R, E2, R2>(this: $D152Stream_Stream<A, E, R>, sink: $D152Stream_Sink.Sink<unknown, A, unknown, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_switchMap {
    "switchMap"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: A) => $D152Stream_Stream<A2, E2, R2>, options?: {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly bufferSize?: number | undefined;
} | undefined): $D152Stream_Stream<A2, E | E2, R | R2>;
}
interface $D152Method_flattenArray {
    "flattenArray"<A, E, R>(this: $D152Stream_Stream<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, R>): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_drain {
    "drain"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<never, E, R>;
}
interface $D152Method_drainFork {
    "drainFork"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_repeatElements {
    "repeatElements"<A, E, R, B, E2, R2>(this: $D152Stream_Stream<A, E, R>, schedule: $D152Stream_Schedule.Schedule<B, unknown, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_flattenIterable {
    "flattenIterable"<A, E, R>(this: $D152Stream_Stream<Iterable<A>, E, R>): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_flattenTake {
    "flattenTake"<A, E, E2, R>(this: $D152Stream_Stream<$D152Stream_Take.Take<A, E>, E2, R>): $D152Stream_Stream<A, E | E2, R>;
}
interface $D152Method_mergeEffect {
    "mergeEffect"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, effect: $D152Stream_Effect.Effect<A2, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_mergeResult {
    "mergeResult"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<$D152Stream_Result.Result<A, A2>, E | E2, R | R2>;
}
interface $D152Method_mergeLeft {
    "mergeLeft"<AL, EL, RL, AR, ER, RR>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>): $D152Stream_Stream<AL, EL | ER, RL | RR>;
}
interface $D152Method_mergeRight {
    "mergeRight"<AL, EL, RL, AR, ER, RR>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>): $D152Stream_Stream<AR, EL | ER, RL | RR>;
}
interface $D152Method_cross {
    "cross"<AL, EL, RL, AR, ER, RR>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>): $D152Stream_Stream<[
    AL,
    AR
], EL | ER, RL | RR>;
}
interface $D152Method_crossWith {
    "crossWith"<AL, EL, RL, AR, ER, RR, A>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>, f: (left: AL, right: AR) => A): $D152Stream_Stream<A, EL | ER, RL | RR>;
}
interface $D152Method_zipWithArray {
    "zipWithArray"<AL, EL, RL, AR, ER, RR, A>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>, f: (left: $D152Stream_Arr.NonEmptyReadonlyArray<AL>, right: $D152Stream_Arr.NonEmptyReadonlyArray<AR>) => readonly [
    output: $D152Stream_Arr.NonEmptyReadonlyArray<A>,
    leftoverLeft: ReadonlyArray<AL>,
    leftoverRight: ReadonlyArray<AR>
]): $D152Stream_Stream<A, EL | ER, RL | RR>;
}
interface $D152Method_zipFlatten {
    "zipFlatten"<A extends ReadonlyArray<any>, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<[
    ...A,
    A2
], E | E2, R | R2>;
}
interface $D152Method_zipWithIndex {
    "zipWithIndex"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<[
    A,
    number
], E, R>;
}
interface $D152Method_zipWithNext {
    "zipWithNext"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<[
    A,
    $D152Stream_Option.Option<A>
], E, R>;
}
interface $D152Method_zipWithPrevious {
    "zipWithPrevious"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<[
    $D152Stream_Option.Option<A>,
    A
], E, R>;
}
interface $D152Method_zipWithPreviousAndNext {
    "zipWithPreviousAndNext"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<[
    $D152Stream_Option.Option<A>,
    A,
    $D152Stream_Option.Option<A>
], E, R>;
}
interface $D152Method_zipLatest {
    "zipLatest"<AL, EL, RL, AR, ER, RR>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>): $D152Stream_Stream<[
    AL,
    AR
], EL | ER, RL | RR>;
}
interface $D152Method_zipLatestWith {
    "zipLatestWith"<AL, EL, RL, AR, ER, RR, A>(this: $D152Stream_Stream<AL, EL, RL>, right: $D152Stream_Stream<AR, ER, RR>, f: (left: AL, right: AR) => A): $D152Stream_Stream<A, EL | ER, RL | RR>;
}
interface $D152Method_filterEffect {
    "filterEffect"<A, E, R, EX, RX>(this: $D152Stream_Stream<A, E, R>, predicate: (a: $D152Stream_NoInfer<A>, i: number) => $D152Stream_Effect.Effect<boolean, EX, RX>): $D152Stream_Stream<A, E | EX, R | RX>;
}
interface $D152Method_filterMapEffect {
    "filterMapEffect"<A, E, R, B, X, EX, RX>(this: $D152Stream_Stream<A, E, R>, filter: $D152Stream_Filter.FilterEffect<A, B, X, EX, RX>): $D152Stream_Stream<B, E | EX, R | RX>;
}
interface $D152Method_partitionQueue {
    "partitionQueue"<A, E, R, Pass, Fail>(this: $D152Stream_Stream<A, E, R>, filter: $D152Stream_Filter.Filter<$D152Stream_NoInfer<A>, Pass, Fail>, options?: {
    readonly capacity?: number | "unbounded" | undefined;
}): $D152Stream_Effect.Effect<[
    passes: $D152Stream_Queue.Dequeue<Pass, E | $D152Stream_Cause.Done>,
    fails: $D152Stream_Queue.Dequeue<Fail, E | $D152Stream_Cause.Done>
], never, R | $D152Stream_Scope.Scope>;
}
interface $D152Method_partitionEffect {
    "partitionEffect"<A, E, R, Pass, Fail, EX, RX>(this: $D152Stream_Stream<A, E, R>, filter: $D152Stream_Filter.FilterEffect<$D152Stream_NoInfer<A>, Pass, Fail, EX, RX>, options?: {
    readonly capacity?: number | "unbounded" | undefined;
    readonly concurrency?: $D152Stream_Concurrency | undefined;
}): $D152Stream_Effect.Effect<[
    passes: $D152Stream_Stream<Pass, E | EX>,
    fails: $D152Stream_Stream<Fail, E | EX>
], never, R | RX | $D152Stream_Scope.Scope>;
}
interface $D152Method_peel {
    "peel"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, sink: $D152Stream_Sink.Sink<A2, A, A, E2, R2>): $D152Stream_Effect.Effect<[
    A2,
    $D152Stream_Stream<A, E, never>
], E | E2, $D152Stream_Scope.Scope | R | R2>;
}
interface $D152Method_buffer {
    "buffer"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly capacity: "unbounded";
} | {
    readonly capacity: number;
    readonly strategy?: "dropping" | "sliding" | "suspend" | undefined;
}): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_bufferArray {
    "bufferArray"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly capacity: "unbounded";
} | {
    readonly capacity: number;
    readonly strategy?: "dropping" | "sliding" | "suspend" | undefined;
}): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_orElseIfEmpty {
    "orElseIfEmpty"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, orElse: $D152Stream_LazyArg<$D152Stream_Stream<A2, E2, R2>>): $D152Stream_Stream<A | A2, E | E2, R | R2>;
}
interface $D152Method_limitBytes {
    "limitBytes"<E, R>(this: $D152Stream_Stream<Uint8Array, E, R>, bytes: $D152Stream_ByteSize.Input, onLimitReached: $D152Stream_LazyArg<$D152Stream_Stream<Uint8Array, E, R>>): $D152Stream_Stream<Uint8Array, E, R>;
}
interface $D152Method_takeUntil {
    "takeUntil"<A, E, R>(this: $D152Stream_Stream<A, E, R>, predicate: (a: A, n: number) => boolean, options?: {
    readonly excludeLast?: boolean | undefined;
}): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_takeUntilEffect {
    "takeUntilEffect"<A, E, R, E2, R2>(this: $D152Stream_Stream<A, E, R>, predicate: (a: A, n: number) => $D152Stream_Effect.Effect<boolean, E2, R2>, options?: {
    readonly excludeLast?: boolean | undefined;
}): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_takeWhileFilter {
    "takeWhileFilter"<A, E, R, B, X>(this: $D152Stream_Stream<A, E, R>, f: $D152Stream_Filter.Filter<$D152Stream_NoInfer<A>, B, X>): $D152Stream_Stream<B, E, R>;
}
interface $D152Method_takeWhileEffect {
    "takeWhileEffect"<A, E, R, E2, R2>(this: $D152Stream_Stream<A, E, R>, predicate: (a: $D152Stream_NoInfer<A>, n: number) => $D152Stream_Effect.Effect<boolean, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_dropUntil {
    "dropUntil"<A, E, R>(this: $D152Stream_Stream<A, E, R>, predicate: (a: $D152Stream_NoInfer<A>, index: number) => boolean): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_dropUntilEffect {
    "dropUntilEffect"<A, E, R, E2, R2>(this: $D152Stream_Stream<A, E, R>, predicate: (a: $D152Stream_NoInfer<A>, index: number) => $D152Stream_Effect.Effect<boolean, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_dropWhileFilter {
    "dropWhileFilter"<A, E, R, B, X>(this: $D152Stream_Stream<A, E, R>, filter: $D152Stream_Filter.Filter<$D152Stream_NoInfer<A>, B, X>): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_dropWhileEffect {
    "dropWhileEffect"<A, E, R, E2, R2>(this: $D152Stream_Stream<A, E, R>, predicate: (a: A, index: number) => $D152Stream_Effect.Effect<boolean, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_chunks {
    "chunks"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, R>;
}
interface $D152Method_rechunk {
    "rechunk"<A, E, R>(this: $D152Stream_Stream<A, E, R>, size: number): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_sliding {
    "sliding"<A, E, R>(this: $D152Stream_Stream<A, E, R>, chunkSize: number): $D152Stream_Stream<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, R>;
}
interface $D152Method_slidingSize {
    "slidingSize"<A, E, R>(this: $D152Stream_Stream<A, E, R>, chunkSize: number, stepSize: number): $D152Stream_Stream<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, R>;
}
interface $D152Method_combineArray {
    "combineArray"<R, A2, E2, R2, S, E, A, A3, E3, R3>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>, s: $D152Stream_LazyArg<S>, f: (s: S, pullLeft: $D152Stream_Pull.Pull<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, void>, pullRight: $D152Stream_Pull.Pull<$D152Stream_Arr.NonEmptyReadonlyArray<A2>, E2, void>) => $D152Stream_Effect.Effect<readonly [
    $D152Stream_Arr.NonEmptyReadonlyArray<A3>,
    S
], E3, R3>): $D152Stream_Stream<A3, $D152Stream_Pull.ExcludeDone<E3>, R | R2 | R3>;
}
interface $D152Method_mapAccumArray {
    "mapAccumArray"<A, E, R, S, B>(this: $D152Stream_Stream<A, E, R>, initial: $D152Stream_LazyArg<S>, f: (s: S, a: $D152Stream_Arr.NonEmptyReadonlyArray<A>) => readonly [
    state: S,
    values: ReadonlyArray<B>
], options?: {
    readonly onHalt?: ((state: S) => ReadonlyArray<B>) | undefined;
}): $D152Stream_Stream<B, E, R>;
}
interface $D152Method_mapAccumEffect {
    "mapAccumEffect"<A, E, R, S, B, E2, R2>(this: $D152Stream_Stream<A, E, R>, initial: $D152Stream_LazyArg<S>, f: (s: S, a: A) => $D152Stream_Effect.Effect<readonly [
    state: S,
    values: ReadonlyArray<B>
], E2, R2>, options?: {
    readonly onHalt?: ((state: S) => ReadonlyArray<B>) | undefined;
}): $D152Stream_Stream<B, E | E2, R | R2>;
}
interface $D152Method_mapAccumArrayEffect {
    "mapAccumArrayEffect"<A, E, R, S, B, E2, R2>(this: $D152Stream_Stream<A, E, R>, initial: $D152Stream_LazyArg<S>, f: (s: S, a: $D152Stream_Arr.NonEmptyReadonlyArray<A>) => $D152Stream_Effect.Effect<readonly [
    state: S,
    values: ReadonlyArray<B>
], E2, R2>, options?: {
    readonly onHalt?: ((state: S) => ReadonlyArray<B>) | undefined;
}): $D152Stream_Stream<B, E | E2, R | R2>;
}
interface $D152Method_scan {
    "scan"<A, E, R, S>(this: $D152Stream_Stream<A, E, R>, initial: $D152Stream_LazyArg<S>, f: (s: S, a: A) => S): $D152Stream_Stream<S, E, R>;
}
interface $D152Method_scanEffect {
    "scanEffect"<A, E, R, S, E2, R2>(this: $D152Stream_Stream<A, E, R>, initial: $D152Stream_LazyArg<S>, f: (s: S, a: A) => $D152Stream_Effect.Effect<S, E2, R2>): $D152Stream_Stream<S, E | E2, R | R2>;
}
interface $D152Method_debounce {
    "debounce"<A, E, R>(this: $D152Stream_Stream<A, E, R>, duration: $D152Stream_Duration.Input): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_throttleEffect {
    "throttleEffect"<A, E, R, E2, R2>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly cost: (arr: $D152Stream_Arr.NonEmptyReadonlyArray<A>) => $D152Stream_Effect.Effect<number, E2, R2>;
    readonly units: number;
    readonly duration: $D152Stream_Duration.Input;
    readonly burst?: number | undefined;
    readonly strategy?: "enforce" | "shape" | undefined;
}): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_throttle {
    "throttle"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly cost: (arr: $D152Stream_Arr.NonEmptyReadonlyArray<A>) => number;
    readonly units: number;
    readonly duration: $D152Stream_Duration.Input;
    readonly burst?: number | undefined;
    readonly strategy?: "enforce" | "shape" | undefined;
}): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_grouped {
    "grouped"<A, E, R>(this: $D152Stream_Stream<A, E, R>, n: number): $D152Stream_Stream<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E, R>;
}
interface $D152Method_groupedWithin {
    "groupedWithin"<A, E, R>(this: $D152Stream_Stream<A, E, R>, chunkSize: number, duration: $D152Stream_Duration.Input): $D152Stream_Stream<Array<A>, E, R>;
}
interface $D152Method_groupBy {
    "groupBy"<A, E, R, K, V, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: $D152Stream_NoInfer<A>) => $D152Stream_Effect.Effect<readonly [
    K,
    V
], E2, R2>, options?: {
    readonly bufferSize?: number | undefined;
    readonly idleTimeToLive?: $D152Stream_Duration.Input | undefined;
}): $D152Stream_Stream<readonly [
    K,
    $D152Stream_Stream<V>
], E | E2, R | R2>;
}
interface $D152Method_groupByKey {
    "groupByKey"<A, E, R, K>(this: $D152Stream_Stream<A, E, R>, f: (a: $D152Stream_NoInfer<A>) => K, options?: {
    readonly bufferSize?: number | undefined;
    readonly idleTimeToLive?: $D152Stream_Duration.Input | undefined;
}): $D152Stream_Stream<readonly [
    K,
    $D152Stream_Stream<A>
], E, R>;
}
interface $D152Method_groupAdjacentBy {
    "groupAdjacentBy"<A, E, R, K>(this: $D152Stream_Stream<A, E, R>, f: (a: $D152Stream_NoInfer<A>) => K): $D152Stream_Stream<readonly [
    K,
    $D152Stream_Arr.NonEmptyArray<A>
], E, R>;
}
interface $D152Method_transduce {
    "transduce"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, sink: $D152Stream_Sink.Sink<A2, A, A, E2, R2>): $D152Stream_Stream<A2, E2 | E, R2 | R>;
}
interface $D152Method_aggregate {
    "aggregate"<A, E, R, B, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, sink: $D152Stream_Sink.Sink<B, A | A2, A2, E2, R2>): $D152Stream_Stream<B, E | E2, R | R2>;
}
interface $D152Method_aggregateWithin {
    "aggregateWithin"<A, E, R, B, A2, E2, R2, C, E3, R3>(this: $D152Stream_Stream<A, E, R>, sink: $D152Stream_Sink.Sink<B, A | A2, A2, E2, R2>, schedule: $D152Stream_Schedule.Schedule<C, $D152Stream_Option.Option<B>, E3, R3>): $D152Stream_Stream<B, E | E2 | E3, R | R2 | R3>;
}
interface $D152Method_broadcastN {
    "broadcastN"<A, E, R, const N extends number>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly n: N;
    readonly capacity: "unbounded";
    readonly replay?: number | undefined;
} | {
    readonly capacity: number;
    readonly n: N;
    readonly strategy?: "sliding" | "dropping" | "suspend" | undefined;
    readonly replay?: number | undefined;
}): $D152Stream_Effect.Effect<$D152Stream_TupleOf<N, $D152Stream_Stream<A, E>>, never, $D152Stream_Scope.Scope | R>;
}
interface $D152Method_broadcast {
    "broadcast"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly capacity: "unbounded";
    readonly replay?: number | undefined;
} | {
    readonly capacity: number;
    readonly strategy?: "sliding" | "dropping" | "suspend" | undefined;
    readonly replay?: number | undefined;
}): $D152Stream_Effect.Effect<$D152Stream_Stream<A, E>, never, $D152Stream_Scope.Scope | R>;
}
interface $D152Method_share {
    "share"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly capacity: "unbounded";
    readonly replay?: number | undefined;
    readonly idleTimeToLive?: $D152Stream_Duration.Input | undefined;
} | {
    readonly capacity: number;
    readonly strategy?: "sliding" | "dropping" | "suspend" | undefined;
    readonly replay?: number | undefined;
    readonly idleTimeToLive?: $D152Stream_Duration.Input | undefined;
}): $D152Stream_Effect.Effect<$D152Stream_Stream<A, E>, never, $D152Stream_Scope.Scope | R>;
}
interface $D152Method_pipeThroughChannel {
    "pipeThroughChannel"<R, R2, E, E2, A, A2>(this: $D152Stream_Stream<A, E, R>, channel: $D152Stream_Channel.Channel<$D152Stream_Arr.NonEmptyReadonlyArray<A2>, E2, unknown, $D152Stream_Arr.NonEmptyReadonlyArray<A>, E, unknown, R2>): $D152Stream_Stream<A2, E2, R | R2>;
}
interface $D152Method_pipeThroughChannelOrFail {
    "pipeThroughChannelOrFail"<R, R2, E, E2, A, A2>(this: $D152Stream_Stream<A, E, R>, channel: $D152Stream_Channel.Channel<$D152Stream_Arr.NonEmptyReadonlyArray<A2>, E2, unknown, $D152Stream_Arr.NonEmptyReadonlyArray<A>, E, unknown, R2>): $D152Stream_Stream<A2, E | E2, R | R2>;
}
interface $D152Method_pipeThrough {
    "pipeThrough"<A, E, R, A2, L, E2, R2>(this: $D152Stream_Stream<A, E, R>, sink: $D152Stream_Sink.Sink<A2, A, L, E2, R2>): $D152Stream_Stream<L, E | E2, R | R2>;
}
interface $D152Method_accumulate {
    "accumulate"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<$D152Stream_Arr.NonEmptyArray<A>, E, R>;
}
interface $D152Method_changes {
    "changes"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_changesWith {
    "changesWith"<A, E, R>(this: $D152Stream_Stream<A, E, R>, f: (x: A, y: A) => boolean): $D152Stream_Stream<A, E, R>;
}
interface $D152Method_changesWithEffect {
    "changesWithEffect"<A, E, R, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (x: A, y: A) => $D152Stream_Effect.Effect<boolean, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_decodeText {
    "decodeText"<Arg extends $D152Stream_Stream<Uint8Array, any, any> | {
    readonly encoding?: string | undefined;
} | undefined = {
    readonly encoding?: string | undefined;
}>(this: Arg, options?: {
    readonly encoding?: string | undefined;
} | undefined): [
    Arg
] extends [
    $D152Stream_Stream<Uint8Array, infer _E, infer _R>
] ? $D152Stream_Stream<string, _E, _R> : <E, R>(self: $D152Stream_Stream<Uint8Array, E, R>) => $D152Stream_Stream<string, E, R>;
}
interface $D152Method_encodeText {
    "encodeText"<E, R>(this: $D152Stream_Stream<string, E, R>): $D152Stream_Stream<Uint8Array, E, R>;
}
interface $D152Method_splitLines {
    "splitLines"<E, R>(this: $D152Stream_Stream<string, E, R>): $D152Stream_Stream<string, E, R>;
}
interface $D152Method_intersperse {
    "intersperse"<A, E, R, A2>(this: $D152Stream_Stream<A, E, R>, element: A2): $D152Stream_Stream<A | A2, E, R>;
}
interface $D152Method_intersperseAffixes {
    "intersperseAffixes"<A, E, R, A2, A3, A4>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly start: A2;
    readonly middle: A3;
    readonly end: A4;
}): $D152Stream_Stream<A | A2 | A3 | A4, E, R>;
}
interface $D152Method_interleave {
    "interleave"<A, E, R, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>): $D152Stream_Stream<A | A2, E | E2, R | R2>;
}
interface $D152Method_interleaveWith {
    "interleaveWith"<A, E, R, A2, E2, R2, E3, R3>(this: $D152Stream_Stream<A, E, R>, that: $D152Stream_Stream<A2, E2, R2>, decider: $D152Stream_Stream<boolean, E3, R3>): $D152Stream_Stream<A | A2, E | E2 | E3, R | R2 | R3>;
}
interface $D152Method_interruptWhen {
    "interruptWhen"<A, E, R, X, E2, R2>(this: $D152Stream_Stream<A, E, R>, effect: $D152Stream_Effect.Effect<X, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_haltWhen {
    "haltWhen"<A, E, R, X, E2, R2>(this: $D152Stream_Stream<A, E, R>, effect: $D152Stream_Effect.Effect<X, E2, R2>): $D152Stream_Stream<A, E | E2, R | R2>;
}
interface $D152Method_onStart {
    "onStart"<A, E, R, X, EX, RX>(this: $D152Stream_Stream<A, E, R>, onStart: $D152Stream_Effect.Effect<X, EX, RX>): $D152Stream_Stream<A, E | EX, R | RX>;
}
interface $D152Method_onFirst {
    "onFirst"<A, E, R, X, EX, RX>(this: $D152Stream_Stream<A, E, R>, onFirst: (element: $D152Stream_NoInfer<A>) => $D152Stream_Effect.Effect<X, EX, RX>): $D152Stream_Stream<A, E | EX, R | RX>;
}
interface $D152Method_onEnd {
    "onEnd"<A, E, R, X, EX, RX>(this: $D152Stream_Stream<A, E, R>, onEnd: $D152Stream_Effect.Effect<X, EX, RX>): $D152Stream_Stream<A, E | EX, R | RX>;
}
interface $D152Method_bindEffect {
    "bindEffect"<A extends Record<string, any>, E, R, B, E2, R2, N extends string>(this: $D152Stream_Stream<A, E, R>, name: N, f: (a: $D152Stream_NoInfer<A>) => $D152Stream_Effect.Effect<B, E2, R2>, options?: {
    readonly concurrency?: $D152Stream_Concurrency | undefined;
    readonly bufferSize?: number | undefined;
    readonly unordered?: boolean | undefined;
} | undefined): $D152Stream_Stream<$D152Stream_Simplify<Omit<A, N> & Record<N, B>>, E | E2, R | R2>;
}
interface $D152Method_run {
    "run"<A, E, R, L, A2, E2, R2>(this: $D152Stream_Stream<A, E, R>, sink: $D152Stream_Sink.Sink<A2, A, L, E2, R2>): $D152Stream_Effect.Effect<A2, E | E2, R | R2>;
}
interface $D152Method_runCollect {
    "runCollect"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Effect.Effect<Array<A>, E, R>;
}
interface $D152Method_runCount {
    "runCount"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Effect.Effect<number, E, R>;
}
interface $D152Method_runSum {
    "runSum"<E, R>(this: $D152Stream_Stream<number, E, R>): $D152Stream_Effect.Effect<number, E, R>;
}
interface $D152Method_runFold {
    "runFold"<A, E, R, Z>(this: $D152Stream_Stream<A, E, R>, initial: $D152Stream_LazyArg<Z>, f: (acc: Z, a: A) => Z): $D152Stream_Effect.Effect<Z, E, R>;
}
interface $D152Method_runFoldEffect {
    "runFoldEffect"<A, E, R, Z, EX, RX>(this: $D152Stream_Stream<A, E, R>, initial: $D152Stream_LazyArg<Z>, f: (acc: Z, a: A) => $D152Stream_Effect.Effect<Z, EX, RX>): $D152Stream_Effect.Effect<Z, E | EX, R | RX>;
}
interface $D152Method_runHead {
    "runHead"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Effect.Effect<$D152Stream_Option.Option<A>, E, R>;
}
interface $D152Method_runLast {
    "runLast"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Effect.Effect<$D152Stream_Option.Option<A>, E, R>;
}
interface $D152Method_runForEach {
    "runForEach"<A, E, R, X, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: A) => $D152Stream_Effect.Effect<X, E2, R2>): $D152Stream_Effect.Effect<void, E | E2, R | R2>;
}
interface $D152Method_runForEachWhile {
    "runForEachWhile"<A, E, R, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: A) => $D152Stream_Effect.Effect<boolean, E2, R2>): $D152Stream_Effect.Effect<void, E | E2, R | R2>;
}
interface $D152Method_runForEachArray {
    "runForEachArray"<A, E, R, X, E2, R2>(this: $D152Stream_Stream<A, E, R>, f: (a: $D152Stream_Arr.NonEmptyReadonlyArray<A>) => $D152Stream_Effect.Effect<X, E2, R2>): $D152Stream_Effect.Effect<void, E | E2, R | R2>;
}
interface $D152Method_runDrain {
    "runDrain"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Effect.Effect<void, E, R>;
}
interface $D152Method_toPull {
    "toPull"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Effect.Effect<$D152Stream_Pull.Pull<$D152Stream_Arr.NonEmptyReadonlyArray<A>, E>, never, R | $D152Stream_Scope.Scope>;
}
interface $D152Method_mkString {
    "mkString"<E, R>(this: $D152Stream_Stream<string, E, R>): $D152Stream_Effect.Effect<string, E, R>;
}
interface $D152Method_mkArrayBuffer {
    "mkArrayBuffer"<E, R>(this: $D152Stream_Stream<Uint8Array, E, R>): $D152Stream_Effect.Effect<ArrayBuffer, E, R>;
}
interface $D152Method_mkUint8Array {
    "mkUint8Array"<E, R>(this: $D152Stream_Stream<Uint8Array, E, R>): $D152Stream_Effect.Effect<Uint8Array<ArrayBuffer>, E, R>;
}
interface $D152Method_toReadableStreamWith {
    "toReadableStreamWith"<A, E, XR, R extends XR>(this: $D152Stream_Stream<A, E, R>, context: $D152Stream_Context.Context<XR>, options?: {
    readonly strategy?: QueuingStrategy<A> | undefined;
    readonly signal?: AbortSignal | undefined;
}): ReadableStream<A>;
}
interface $D152Method_toReadableStream {
    "toReadableStream"<A, E>(this: $D152Stream_Stream<A, E>, options?: {
    readonly strategy?: QueuingStrategy<A> | undefined;
}): ReadableStream<A>;
}
interface $D152Method_toReadableStreamEffect {
    "toReadableStreamEffect"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options?: {
    readonly strategy?: QueuingStrategy<A> | undefined;
}): $D152Stream_Effect.Effect<ReadableStream<A>, never, R>;
}
interface $D152Method_toAsyncIterableWith {
    "toAsyncIterableWith"<A, E, XR, R extends XR>(this: $D152Stream_Stream<A, E, R>, context: $D152Stream_Context.Context<XR>): AsyncIterable<A>;
}
interface $D152Method_toAsyncIterableEffect {
    "toAsyncIterableEffect"<A, E, R>(this: $D152Stream_Stream<A, E, R>): $D152Stream_Effect.Effect<AsyncIterable<A>, never, R>;
}
interface $D152Method_toAsyncIterable {
    "toAsyncIterable"<A, E>(this: $D152Stream_Stream<A, E>): AsyncIterable<A>;
}
interface $D152Method_runIntoPubSub {
    "runIntoPubSub"<A, E, R>(this: $D152Stream_Stream<A, E, R>, pubsub: $D152Stream_PubSub.PubSub<A>, options?: {
    readonly shutdownOnEnd?: boolean | undefined;
} | undefined): $D152Stream_Effect.Effect<void, E, R>;
}
interface $D152Method_toPubSub {
    "toPubSub"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly capacity: "unbounded";
    readonly replay?: number | undefined;
    readonly shutdownOnEnd?: boolean | undefined;
} | {
    readonly capacity: number;
    readonly strategy?: "dropping" | "sliding" | "suspend" | undefined;
    readonly replay?: number | undefined;
    readonly shutdownOnEnd?: boolean | undefined;
}): $D152Stream_Effect.Effect<$D152Stream_PubSub.PubSub<A>, never, R | $D152Stream_Scope.Scope>;
}
interface $D152Method_toPubSubTake {
    "toPubSubTake"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly capacity: "unbounded";
    readonly replay?: number | undefined;
} | {
    readonly capacity: number;
    readonly strategy?: "dropping" | "sliding" | "suspend" | undefined;
    readonly replay?: number | undefined;
}): $D152Stream_Effect.Effect<$D152Stream_PubSub.PubSub<$D152Stream_Take.Take<A, E>>, never, R | $D152Stream_Scope.Scope>;
}
interface $D152Method_toQueue {
    "toQueue"<A, E, R>(this: $D152Stream_Stream<A, E, R>, options: {
    readonly capacity: "unbounded";
} | {
    readonly capacity: number;
    readonly strategy?: "dropping" | "sliding" | "suspend" | undefined;
}): $D152Stream_Effect.Effect<$D152Stream_Queue.Dequeue<A, E | $D152Stream_Cause.Done>, never, R | $D152Stream_Scope.Scope>;
}
interface $D152Method_runIntoQueue {
    "runIntoQueue"<A, E, R>(this: $D152Stream_Stream<A, E, R>, queue: $D152Stream_Queue.Queue<A, E | $D152Stream_Cause.Done>): $D152Stream_Effect.Effect<void, never, R>;
}
declare module "effect/BigDecimal" {
  interface BigDecimal extends $D152Method_normalize, $D152Method_sum, $D152Method_multiply, $D152Method_subtract, $D152Method_divide, $D152Method_divideUnsafe, $D152Method_isLessThan, $D152Method_isLessThanOrEqualTo, $D152Method_isGreaterThan, $D152Method_isGreaterThanOrEqualTo, $D152Method_between, $D152Method_clamp, $D152Method_min, $D152Method_max, $D152Method_sign, $D152Method_abs, $D152Method_negate, $D152Method_remainder, $D152Method_remainderUnsafe, $D152Method_equals, $D152Method_format, $D152Method_toExponential, $D152Method_toNumberUnsafe, $D152Method_isInteger, $D152Method_isZero, $D152Method_isNegative, $D152Method_isPositive, $D152Method_round, $D152Method_truncate, $D152Method_ceil, $D152Method_floor {}
}

declare module "effect/Cause" {
  interface Cause<out E> extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface Die extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface Fail<out E> extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface Interrupt extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface NoSuchElementError extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface Done<A = void> extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface TimeoutError extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface IllegalArgumentError extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface ExceededCapacityError extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface AsyncFiberError extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
  interface UnknownError extends $D152Method_isCause, $D152Method_isReason, $D152Method_isFailReason, $D152Method_isDieReason, $D152Method_isInterruptReason, $D152Method_hasInterruptsOnly, $D152Method_map, $D152Method_combine, $D152Method_squash, $D152Method_hasFails, $D152Method_findFail, $D152Method_findError, $D152Method_findErrorOption, $D152Method_hasDies, $D152Method_findDie, $D152Method_findDefect, $D152Method_hasInterrupts, $D152Method_findInterrupt, $D152Method_interruptors, $D152Method_filterInterruptors, $D152Method_prettyErrors, $D152Method_pretty, $D152Method_reasonAnnotations {}
}

declare module "effect/Chunk" {
  interface Chunk<out A> extends $D152Method_fromIterable, $D152Method_toArray, $D152Method_toReadonlyArray, $D152Method_reverse, $D152Method_get, $D152Method_fromArrayUnsafe, $D152Method_fromNonEmptyArrayUnsafe, $D152Method_getUnsafe, $D152Method_append, $D152Method_prepend, $D152Method_take, $D152Method_drop, $D152Method_dropRight, $D152Method_dropWhile, $D152Method_prependAll, $D152Method_appendAll, $D152Method_filterMap, $D152Method_filter, $D152Method_filterMapWhile, $D152Method_compact, $D152Method_flatMap, $D152Method_forEach, $D152Method_flatten, $D152Method_chunksOf, $D152Method_intersection, $D152Method_isEmpty, $D152Method_isNonEmpty, $D152Method_head, $D152Method_headUnsafe, $D152Method_headNonEmpty, $D152Method_last, $D152Method_lastUnsafe, $D152Method_lastNonEmpty, $D152Method_map, $D152Method_mapAccum, $D152Method_partition, $D152Method_separate, $D152Method_size, $D152Method_sort, $D152Method_sortWith, $D152Method_splitAt, $D152Method_splitNonEmptyAt, $D152Method_split, $D152Method_splitWhere, $D152Method_tail, $D152Method_tailNonEmpty, $D152Method_takeRight, $D152Method_takeWhile, $D152Method_union, $D152Method_dedupe, $D152Method_dedupeAdjacent, $D152Method_unzip, $D152Method_zipWith, $D152Method_zip, $D152Method_remove, $D152Method_modify, $D152Method_replace, $D152Method_contains, $D152Method_findFirst, $D152Method_findFirstIndex, $D152Method_findLast, $D152Method_findLastIndex, $D152Method_every, $D152Method_some, $D152Method_join, $D152Method_reduce, $D152Method_reduceRight, $D152Method_difference {}
  interface NonEmptyChunk<out A> extends $D152Method_fromIterable, $D152Method_toArray, $D152Method_toReadonlyArray, $D152Method_reverse, $D152Method_get, $D152Method_fromArrayUnsafe, $D152Method_fromNonEmptyArrayUnsafe, $D152Method_getUnsafe, $D152Method_append, $D152Method_prepend, $D152Method_take, $D152Method_drop, $D152Method_dropRight, $D152Method_dropWhile, $D152Method_prependAll, $D152Method_appendAll, $D152Method_filterMap, $D152Method_filter, $D152Method_filterMapWhile, $D152Method_compact, $D152Method_flatMap, $D152Method_forEach, $D152Method_flatten, $D152Method_chunksOf, $D152Method_intersection, $D152Method_isEmpty, $D152Method_isNonEmpty, $D152Method_head, $D152Method_headUnsafe, $D152Method_headNonEmpty, $D152Method_last, $D152Method_lastUnsafe, $D152Method_lastNonEmpty, $D152Method_map, $D152Method_mapAccum, $D152Method_partition, $D152Method_separate, $D152Method_size, $D152Method_sort, $D152Method_sortWith, $D152Method_splitAt, $D152Method_splitNonEmptyAt, $D152Method_split, $D152Method_splitWhere, $D152Method_tail, $D152Method_tailNonEmpty, $D152Method_takeRight, $D152Method_takeWhile, $D152Method_union, $D152Method_dedupe, $D152Method_dedupeAdjacent, $D152Method_unzip, $D152Method_zipWith, $D152Method_zip, $D152Method_remove, $D152Method_modify, $D152Method_replace, $D152Method_contains, $D152Method_findFirst, $D152Method_findFirstIndex, $D152Method_findLast, $D152Method_findLastIndex, $D152Method_every, $D152Method_some, $D152Method_join, $D152Method_reduce, $D152Method_reduceRight, $D152Method_difference {}
}

declare module "effect/DateTime" {
  interface Utc extends $D152Method_isUtc, $D152Method_isZoned, $D152Method_clamp, $D152Method_toUtc, $D152Method_setZone, $D152Method_setZoneOffset, $D152Method_zoneToString, $D152Method_setZoneNamed, $D152Method_setZoneNamedUnsafe, $D152Method_distance, $D152Method_min, $D152Method_max, $D152Method_isGreaterThan, $D152Method_isGreaterThanOrEqualTo, $D152Method_isLessThan, $D152Method_isLessThanOrEqualTo, $D152Method_between, $D152Method_isFuture, $D152Method_isFutureUnsafe, $D152Method_isPast, $D152Method_isPastUnsafe, $D152Method_toDateUtc, $D152Method_toDate, $D152Method_zonedOffset, $D152Method_zonedOffsetIso, $D152Method_toEpochMillis, $D152Method_toEpochSeconds, $D152Method_removeTime, $D152Method_toParts, $D152Method_toPartsUtc, $D152Method_getPartUtc, $D152Method_getPart, $D152Method_setParts, $D152Method_setPartsUtc, $D152Method_setZoneCurrent, $D152Method_withCurrentZone, $D152Method_mutate, $D152Method_mutateUtc, $D152Method_mapEpochMillis, $D152Method_withDate, $D152Method_withDateUtc, $D152Method_match, $D152Method_addDuration, $D152Method_subtractDuration, $D152Method_add, $D152Method_subtract, $D152Method_startOf, $D152Method_endOf, $D152Method_nearest, $D152Method_format, $D152Method_formatLocal, $D152Method_formatUtc, $D152Method_formatIntl, $D152Method_formatIso, $D152Method_formatIsoDate, $D152Method_formatIsoDateUtc, $D152Method_formatIsoOffset, $D152Method_formatIsoZoned {}
  interface Zoned extends $D152Method_isUtc, $D152Method_isZoned, $D152Method_clamp, $D152Method_toUtc, $D152Method_setZone, $D152Method_setZoneOffset, $D152Method_zoneToString, $D152Method_setZoneNamed, $D152Method_setZoneNamedUnsafe, $D152Method_distance, $D152Method_min, $D152Method_max, $D152Method_isGreaterThan, $D152Method_isGreaterThanOrEqualTo, $D152Method_isLessThan, $D152Method_isLessThanOrEqualTo, $D152Method_between, $D152Method_isFuture, $D152Method_isFutureUnsafe, $D152Method_isPast, $D152Method_isPastUnsafe, $D152Method_toDateUtc, $D152Method_toDate, $D152Method_zonedOffset, $D152Method_zonedOffsetIso, $D152Method_toEpochMillis, $D152Method_toEpochSeconds, $D152Method_removeTime, $D152Method_toParts, $D152Method_toPartsUtc, $D152Method_getPartUtc, $D152Method_getPart, $D152Method_setParts, $D152Method_setPartsUtc, $D152Method_setZoneCurrent, $D152Method_withCurrentZone, $D152Method_mutate, $D152Method_mutateUtc, $D152Method_mapEpochMillis, $D152Method_withDate, $D152Method_withDateUtc, $D152Method_match, $D152Method_addDuration, $D152Method_subtractDuration, $D152Method_add, $D152Method_subtract, $D152Method_startOf, $D152Method_endOf, $D152Method_nearest, $D152Method_format, $D152Method_formatLocal, $D152Method_formatUtc, $D152Method_formatIntl, $D152Method_formatIso, $D152Method_formatIsoDate, $D152Method_formatIsoDateUtc, $D152Method_formatIsoOffset, $D152Method_formatIsoZoned {}
  namespace TimeZone {
  interface Offset extends $D152Method_isUtc, $D152Method_isZoned, $D152Method_clamp, $D152Method_toUtc, $D152Method_setZone, $D152Method_setZoneOffset, $D152Method_zoneToString, $D152Method_setZoneNamed, $D152Method_setZoneNamedUnsafe, $D152Method_distance, $D152Method_min, $D152Method_max, $D152Method_isGreaterThan, $D152Method_isGreaterThanOrEqualTo, $D152Method_isLessThan, $D152Method_isLessThanOrEqualTo, $D152Method_between, $D152Method_isFuture, $D152Method_isFutureUnsafe, $D152Method_isPast, $D152Method_isPastUnsafe, $D152Method_toDateUtc, $D152Method_toDate, $D152Method_zonedOffset, $D152Method_zonedOffsetIso, $D152Method_toEpochMillis, $D152Method_toEpochSeconds, $D152Method_removeTime, $D152Method_toParts, $D152Method_toPartsUtc, $D152Method_getPartUtc, $D152Method_getPart, $D152Method_setParts, $D152Method_setPartsUtc, $D152Method_setZoneCurrent, $D152Method_withCurrentZone, $D152Method_mutate, $D152Method_mutateUtc, $D152Method_mapEpochMillis, $D152Method_withDate, $D152Method_withDateUtc, $D152Method_match, $D152Method_addDuration, $D152Method_subtractDuration, $D152Method_add, $D152Method_subtract, $D152Method_startOf, $D152Method_endOf, $D152Method_nearest, $D152Method_format, $D152Method_formatLocal, $D152Method_formatUtc, $D152Method_formatIntl, $D152Method_formatIso, $D152Method_formatIsoDate, $D152Method_formatIsoDateUtc, $D152Method_formatIsoOffset, $D152Method_formatIsoZoned {}
  }
  namespace TimeZone {
  interface Named extends $D152Method_isUtc, $D152Method_isZoned, $D152Method_clamp, $D152Method_toUtc, $D152Method_setZone, $D152Method_setZoneOffset, $D152Method_zoneToString, $D152Method_setZoneNamed, $D152Method_setZoneNamedUnsafe, $D152Method_distance, $D152Method_min, $D152Method_max, $D152Method_isGreaterThan, $D152Method_isGreaterThanOrEqualTo, $D152Method_isLessThan, $D152Method_isLessThanOrEqualTo, $D152Method_between, $D152Method_isFuture, $D152Method_isFutureUnsafe, $D152Method_isPast, $D152Method_isPastUnsafe, $D152Method_toDateUtc, $D152Method_toDate, $D152Method_zonedOffset, $D152Method_zonedOffsetIso, $D152Method_toEpochMillis, $D152Method_toEpochSeconds, $D152Method_removeTime, $D152Method_toParts, $D152Method_toPartsUtc, $D152Method_getPartUtc, $D152Method_getPart, $D152Method_setParts, $D152Method_setPartsUtc, $D152Method_setZoneCurrent, $D152Method_withCurrentZone, $D152Method_mutate, $D152Method_mutateUtc, $D152Method_mapEpochMillis, $D152Method_withDate, $D152Method_withDateUtc, $D152Method_match, $D152Method_addDuration, $D152Method_subtractDuration, $D152Method_add, $D152Method_subtract, $D152Method_startOf, $D152Method_endOf, $D152Method_nearest, $D152Method_format, $D152Method_formatLocal, $D152Method_formatUtc, $D152Method_formatIntl, $D152Method_formatIso, $D152Method_formatIsoDate, $D152Method_formatIsoDateUtc, $D152Method_formatIsoOffset, $D152Method_formatIsoZoned {}
  }
}

declare module "effect/Deferred" {
  interface Deferred<in out A, in out E = never> extends $D152Method_complete, $D152Method_completeWith, $D152Method_done, $D152Method_fail, $D152Method_failSync, $D152Method_failCause, $D152Method_failCauseSync, $D152Method_die, $D152Method_dieSync, $D152Method_interrupt, $D152Method_interruptWith, $D152Method_isDone, $D152Method_isDoneUnsafe, $D152Method_poll, $D152Method_succeed, $D152Method_sync, $D152Method_doneUnsafe, $D152Method_into, $D152Method_await {}
}

declare module "effect/Duration" {
  interface Duration extends $D152Method_isFinite, $D152Method_isZero, $D152Method_isNegative, $D152Method_isPositive, $D152Method_abs, $D152Method_negate, $D152Method_toMillis, $D152Method_toSeconds, $D152Method_toMinutes, $D152Method_toHours, $D152Method_toDays, $D152Method_toWeeks, $D152Method_toNanosUnsafe, $D152Method_toNanos, $D152Method_toHrTime, $D152Method_match, $D152Method_matchPair, $D152Method_between, $D152Method_min, $D152Method_max, $D152Method_clamp, $D152Method_divide, $D152Method_divideUnsafe, $D152Method_times, $D152Method_subtract, $D152Method_sum, $D152Method_isLessThan, $D152Method_isLessThanOrEqualTo, $D152Method_isGreaterThan, $D152Method_isGreaterThanOrEqualTo, $D152Method_equals, $D152Method_parts, $D152Method_format {}
}

declare module "effect/Effect" {
  interface Effect<out A, out E = never, out R = never> extends $D152Method_forEach, $D152Method_head, $D152Method_bindTo, $D152Method_bind, $D152Method_transposeOption, $D152Method_flatMap, $D152Method_flatten, $D152Method_andThen, $D152Method_tap, $D152Method_result, $D152Method_option, $D152Method_exit, $D152Method_map, $D152Method_as, $D152Method_asSome, $D152Method_asVoid, $D152Method_flip, $D152Method_zip, $D152Method_zipWith, $D152Method_catchTag, $D152Method_catchTags, $D152Method_catchReason, $D152Method_catchReasons, $D152Method_unwrapReason, $D152Method_catchCause, $D152Method_catchDefect, $D152Method_catchIf, $D152Method_catchFilter, $D152Method_catchNoSuchElement, $D152Method_catchCauseIf, $D152Method_catchCauseFilter, $D152Method_mapError, $D152Method_mapBoth, $D152Method_orDie, $D152Method_tapError, $D152Method_tapErrorTag, $D152Method_tapCause, $D152Method_tapCauseIf, $D152Method_tapCauseFilter, $D152Method_tapDefect, $D152Method_eventually, $D152Method_retry, $D152Method_retryOrElse, $D152Method_sandbox, $D152Method_ignore, $D152Method_ignoreCause, $D152Method_withExecutionPlan, $D152Method_withErrorReporting, $D152Method_orElseSucceed, $D152Method_timeout, $D152Method_timeoutOption, $D152Method_timeoutOrElse, $D152Method_delay, $D152Method_timed, $D152Method_race, $D152Method_raceFirst, $D152Method_filterOrElse, $D152Method_filterMapOrElse, $D152Method_filterOrFail, $D152Method_filterMapOrFail, $D152Method_when, $D152Method_match, $D152Method_matchEager, $D152Method_matchCause, $D152Method_matchCauseEager, $D152Method_matchCauseEffectEager, $D152Method_matchCauseEffect, $D152Method_matchEffect, $D152Method_isFailure, $D152Method_isSuccess, $D152Method_provide, $D152Method_provideContext, $D152Method_setContext, $D152Method_updateContext, $D152Method_updateService, $D152Method_provideService, $D152Method_provideServiceEffect, $D152Method_scoped, $D152Method_ensuring, $D152Method_onError, $D152Method_onErrorIf, $D152Method_onErrorFilter, $D152Method_onExitPrimitive, $D152Method_onExit, $D152Method_onExitIf, $D152Method_onExitFilter, $D152Method_cached, $D152Method_cachedWithTTL, $D152Method_cachedInvalidateWithTTL, $D152Method_interruptible, $D152Method_onInterrupt, $D152Method_uninterruptible, $D152Method_forever, $D152Method_repeat, $D152Method_repeatOrElse, $D152Method_replicate, $D152Method_replicateEffect, $D152Method_schedule, $D152Method_scheduleFrom, $D152Method_withTracer, $D152Method_withTracerEnabled, $D152Method_withTracerTiming, $D152Method_annotateSpans, $D152Method_linkSpans, $D152Method_withSpan, $D152Method_withSpanScoped, $D152Method_withParentSpan, $D152Method_request, $D152Method_requestUnsafe, $D152Method_forkChild, $D152Method_forkIn, $D152Method_forkScoped, $D152Method_forkDetach, $D152Method_awaitAllChildren, $D152Method_withLogger, $D152Method_annotateLogs, $D152Method_withLogSpan, $D152Method_track, $D152Method_trackSuccesses, $D152Method_trackErrors, $D152Method_trackDefects, $D152Method_trackDuration, $D152Method_tx, $D152Method_mapEager, $D152Method_mapErrorEager, $D152Method_mapBothEager, $D152Method_flatMapEager, $D152Method_catchEager, $D152Method_let, $D152Method_catch {}
}

declare module "effect/Exit" {
  interface Success<out A, out E = never> extends $D152Method_isSuccess, $D152Method_isFailure, $D152Method_hasFails, $D152Method_hasDies, $D152Method_hasInterrupts, $D152Method_filterSuccess, $D152Method_filterValue, $D152Method_filterFailure, $D152Method_filterCause, $D152Method_findError, $D152Method_findDefect, $D152Method_match, $D152Method_map, $D152Method_mapError, $D152Method_mapBoth, $D152Method_asVoid, $D152Method_getSuccess, $D152Method_getCause, $D152Method_findErrorOption {}
  interface Failure<out A, out E> extends $D152Method_isSuccess, $D152Method_isFailure, $D152Method_hasFails, $D152Method_hasDies, $D152Method_hasInterrupts, $D152Method_filterSuccess, $D152Method_filterValue, $D152Method_filterFailure, $D152Method_filterCause, $D152Method_findError, $D152Method_findDefect, $D152Method_match, $D152Method_map, $D152Method_mapError, $D152Method_mapBoth, $D152Method_asVoid, $D152Method_getSuccess, $D152Method_getCause, $D152Method_findErrorOption {}
}

declare module "effect/Fiber" {
  interface Fiber<out A, out E = never> extends $D152Method_awaitAll, $D152Method_join, $D152Method_joinAll, $D152Method_interrupt, $D152Method_interruptAs, $D152Method_runIn, $D152Method_await {}
}

declare module "effect/HashMap" {
  interface HashMap<out Key, out Value> extends $D152Method_isEmpty, $D152Method_get, $D152Method_getHash, $D152Method_getUnsafe, $D152Method_has, $D152Method_hasHash, $D152Method_hasBy, $D152Method_set, $D152Method_keys, $D152Method_values, $D152Method_toValues, $D152Method_entries, $D152Method_toEntries, $D152Method_size, $D152Method_beginMutation, $D152Method_endMutation, $D152Method_mutate, $D152Method_modifyAt, $D152Method_modifyHash, $D152Method_modify, $D152Method_union, $D152Method_remove, $D152Method_removeMany, $D152Method_setMany, $D152Method_map, $D152Method_flatMap, $D152Method_forEach, $D152Method_reduce, $D152Method_filter, $D152Method_compact, $D152Method_filterMap, $D152Method_findFirst, $D152Method_some, $D152Method_every {}
}

declare module "effect/HashSet" {
  interface HashSet<out Value> extends $D152Method_add, $D152Method_has, $D152Method_remove, $D152Method_size, $D152Method_isEmpty, $D152Method_union, $D152Method_intersection, $D152Method_difference, $D152Method_isSubset, $D152Method_map, $D152Method_filter, $D152Method_some, $D152Method_every, $D152Method_reduce {}
}

declare module "effect/Option" {
  interface None<out A> extends $D152Method_isNone, $D152Method_isSome, $D152Method_match, $D152Method_getSuccess, $D152Method_getFailure, $D152Method_getOrElse, $D152Method_orElse, $D152Method_orElseSome, $D152Method_orElseResult, $D152Method_getOrNull, $D152Method_getOrUndefined, $D152Method_getOrThrowWith, $D152Method_getOrThrow, $D152Method_map, $D152Method_as, $D152Method_asVoid, $D152Method_flatMap, $D152Method_andThen, $D152Method_flatMapNullishOr, $D152Method_flatten, $D152Method_zipRight, $D152Method_zipLeft, $D152Method_tap, $D152Method_product, $D152Method_productMany, $D152Method_zipWith, $D152Method_reduceCompact, $D152Method_toArray, $D152Method_partitionMap, $D152Method_filterMap, $D152Method_filter, $D152Method_liftPredicate, $D152Method_contains, $D152Method_exists, $D152Method_bindTo, $D152Method_bind, $D152Method_let {}
  interface Some<out A> extends $D152Method_isNone, $D152Method_isSome, $D152Method_match, $D152Method_getSuccess, $D152Method_getFailure, $D152Method_getOrElse, $D152Method_orElse, $D152Method_orElseSome, $D152Method_orElseResult, $D152Method_getOrNull, $D152Method_getOrUndefined, $D152Method_getOrThrowWith, $D152Method_getOrThrow, $D152Method_map, $D152Method_as, $D152Method_asVoid, $D152Method_flatMap, $D152Method_andThen, $D152Method_flatMapNullishOr, $D152Method_flatten, $D152Method_zipRight, $D152Method_zipLeft, $D152Method_tap, $D152Method_product, $D152Method_productMany, $D152Method_zipWith, $D152Method_reduceCompact, $D152Method_toArray, $D152Method_partitionMap, $D152Method_filterMap, $D152Method_filter, $D152Method_liftPredicate, $D152Method_contains, $D152Method_exists, $D152Method_bindTo, $D152Method_bind, $D152Method_let {}
}

declare module "effect/Queue" {
  interface Enqueue<in A, in E = never> extends $D152Method_asEnqueue, $D152Method_asDequeue, $D152Method_offer, $D152Method_offerUnsafe, $D152Method_offerAll, $D152Method_offerAllUnsafe, $D152Method_fail, $D152Method_failCause, $D152Method_failCauseUnsafe, $D152Method_end, $D152Method_endUnsafe, $D152Method_interrupt, $D152Method_shutdown, $D152Method_shutdownUnsafe, $D152Method_clear, $D152Method_takeAll, $D152Method_collect, $D152Method_takeN, $D152Method_takeBetween, $D152Method_take, $D152Method_poll, $D152Method_peek, $D152Method_takeUnsafe, $D152Method_flushUnsafe, $D152Method_flush, $D152Method_size, $D152Method_isFull, $D152Method_sizeUnsafe, $D152Method_isFullUnsafe, $D152Method_into, $D152Method_await {}
  interface Dequeue<out A, out E = never> extends $D152Method_asEnqueue, $D152Method_asDequeue, $D152Method_offer, $D152Method_offerUnsafe, $D152Method_offerAll, $D152Method_offerAllUnsafe, $D152Method_fail, $D152Method_failCause, $D152Method_failCauseUnsafe, $D152Method_end, $D152Method_endUnsafe, $D152Method_interrupt, $D152Method_shutdown, $D152Method_shutdownUnsafe, $D152Method_clear, $D152Method_takeAll, $D152Method_collect, $D152Method_takeN, $D152Method_takeBetween, $D152Method_take, $D152Method_poll, $D152Method_peek, $D152Method_takeUnsafe, $D152Method_flushUnsafe, $D152Method_flush, $D152Method_size, $D152Method_isFull, $D152Method_sizeUnsafe, $D152Method_isFullUnsafe, $D152Method_into, $D152Method_await {}
  interface Queue<in out A, in out E = never> extends $D152Method_asEnqueue, $D152Method_asDequeue, $D152Method_offer, $D152Method_offerUnsafe, $D152Method_offerAll, $D152Method_offerAllUnsafe, $D152Method_fail, $D152Method_failCause, $D152Method_failCauseUnsafe, $D152Method_end, $D152Method_endUnsafe, $D152Method_interrupt, $D152Method_shutdown, $D152Method_shutdownUnsafe, $D152Method_clear, $D152Method_takeAll, $D152Method_collect, $D152Method_takeN, $D152Method_takeBetween, $D152Method_take, $D152Method_poll, $D152Method_peek, $D152Method_takeUnsafe, $D152Method_flushUnsafe, $D152Method_flush, $D152Method_size, $D152Method_isFull, $D152Method_sizeUnsafe, $D152Method_isFullUnsafe, $D152Method_into, $D152Method_await {}
}

declare module "effect/Ref" {
  interface Ref<in out A> extends $D152Method_get, $D152Method_set, $D152Method_getAndSet, $D152Method_getAndUpdate, $D152Method_getAndUpdateSome, $D152Method_setAndGet, $D152Method_modify, $D152Method_modifySome, $D152Method_update, $D152Method_updateAndGet, $D152Method_updateSome, $D152Method_updateSomeAndGet, $D152Method_getUnsafe {}
}

declare module "effect/Result" {
  interface Failure<out A, out E> extends $D152Method_fromNullishOr, $D152Method_fromOption, $D152Method_isFailure, $D152Method_isSuccess, $D152Method_getSuccess, $D152Method_getFailure, $D152Method_mapBoth, $D152Method_mapError, $D152Method_map, $D152Method_match, $D152Method_liftPredicate, $D152Method_filterOrFail, $D152Method_merge, $D152Method_getOrElse, $D152Method_getOrNull, $D152Method_getOrUndefined, $D152Method_getOrThrowWith, $D152Method_getOrThrow, $D152Method_orElse, $D152Method_flatMap, $D152Method_andThen, $D152Method_flip, $D152Method_bind, $D152Method_bindTo, $D152Method_transposeOption, $D152Method_transposeMapOption, $D152Method_tap, $D152Method_let {}
  interface Success<out A, out E> extends $D152Method_fromNullishOr, $D152Method_fromOption, $D152Method_isFailure, $D152Method_isSuccess, $D152Method_getSuccess, $D152Method_getFailure, $D152Method_mapBoth, $D152Method_mapError, $D152Method_map, $D152Method_match, $D152Method_liftPredicate, $D152Method_filterOrFail, $D152Method_merge, $D152Method_getOrElse, $D152Method_getOrNull, $D152Method_getOrUndefined, $D152Method_getOrThrowWith, $D152Method_getOrThrow, $D152Method_orElse, $D152Method_flatMap, $D152Method_andThen, $D152Method_flip, $D152Method_bind, $D152Method_bindTo, $D152Method_transposeOption, $D152Method_transposeMapOption, $D152Method_tap, $D152Method_let {}
}

declare module "effect/Schedule" {
  interface Schedule<out Output, in Input = unknown, out Error = never, out Env = never> extends $D152Method_toStep, $D152Method_toStepWithMetadata, $D152Method_toStepWithSleep, $D152Method_addDelay, $D152Method_concat, $D152Method_concatResult, $D152Method_map, $D152Method_modifyDelay, $D152Method_jittered, $D152Method_passthrough, $D152Method_tap, $D152Method_upTo, $D152Method_while {}
}

declare module "effect/Sink" {
  interface Sink<out A, in In = unknown, out L = never, out E = never, out R = never> extends $D152Method_toChannel, $D152Method_ignoreLeftover, $D152Method_map, $D152Method_as, $D152Method_mapInput, $D152Method_mapInputEffect, $D152Method_mapInputArray, $D152Method_mapInputArrayEffect, $D152Method_mapEnd, $D152Method_mapEffectEnd, $D152Method_mapEffect, $D152Method_mapError, $D152Method_mapLeftover, $D152Method_flatMap, $D152Method_summarized, $D152Method_withDuration, $D152Method_provideContext, $D152Method_provideService, $D152Method_orElse, $D152Method_catchCause, $D152Method_onExit, $D152Method_ensuring, $D152Method_catch {}
}

declare module "effect/Stream" {
  interface Stream<out A, out E = never, out R = never> extends $D152Method_transformPull, $D152Method_transformPullBracket, $D152Method_toChannel, $D152Method_scoped, $D152Method_map, $D152Method_as, $D152Method_mapBoth, $D152Method_mapArray, $D152Method_mapEffect, $D152Method_flattenEffect, $D152Method_mapArrayEffect, $D152Method_result, $D152Method_tap, $D152Method_tapBoth, $D152Method_tapSink, $D152Method_flatMap, $D152Method_switchMap, $D152Method_flatten, $D152Method_flattenArray, $D152Method_drain, $D152Method_drainFork, $D152Method_repeat, $D152Method_schedule, $D152Method_timeout, $D152Method_timeoutOrElse, $D152Method_repeatElements, $D152Method_forever, $D152Method_flattenIterable, $D152Method_flattenTake, $D152Method_concat, $D152Method_prepend, $D152Method_merge, $D152Method_mergeEffect, $D152Method_mergeResult, $D152Method_mergeLeft, $D152Method_mergeRight, $D152Method_cross, $D152Method_crossWith, $D152Method_zipWith, $D152Method_zipWithArray, $D152Method_zip, $D152Method_zipLeft, $D152Method_zipRight, $D152Method_zipFlatten, $D152Method_zipWithIndex, $D152Method_zipWithNext, $D152Method_zipWithPrevious, $D152Method_zipWithPreviousAndNext, $D152Method_zipLatest, $D152Method_zipLatestWith, $D152Method_race, $D152Method_filter, $D152Method_filterMap, $D152Method_filterEffect, $D152Method_filterMapEffect, $D152Method_partitionQueue, $D152Method_partitionEffect, $D152Method_partition, $D152Method_when, $D152Method_peel, $D152Method_buffer, $D152Method_bufferArray, $D152Method_catchCause, $D152Method_catchDefect, $D152Method_tapCause, $D152Method_tapError, $D152Method_tapErrorTag, $D152Method_tapDefect, $D152Method_catchIf, $D152Method_catchFilter, $D152Method_catchTag, $D152Method_catchTags, $D152Method_catchReason, $D152Method_catchReasons, $D152Method_unwrapReason, $D152Method_mapError, $D152Method_catchCauseIf, $D152Method_catchCauseFilter, $D152Method_orElseIfEmpty, $D152Method_orElseSucceed, $D152Method_orDie, $D152Method_ignore, $D152Method_ignoreCause, $D152Method_retry, $D152Method_withExecutionPlan, $D152Method_take, $D152Method_limitBytes, $D152Method_takeRight, $D152Method_takeUntil, $D152Method_takeUntilEffect, $D152Method_takeWhile, $D152Method_takeWhileFilter, $D152Method_takeWhileEffect, $D152Method_drop, $D152Method_dropUntil, $D152Method_dropUntilEffect, $D152Method_dropWhile, $D152Method_dropWhileFilter, $D152Method_dropWhileEffect, $D152Method_dropRight, $D152Method_chunks, $D152Method_rechunk, $D152Method_sliding, $D152Method_slidingSize, $D152Method_split, $D152Method_combine, $D152Method_combineArray, $D152Method_mapAccum, $D152Method_mapAccumArray, $D152Method_mapAccumEffect, $D152Method_mapAccumArrayEffect, $D152Method_scan, $D152Method_scanEffect, $D152Method_debounce, $D152Method_throttleEffect, $D152Method_throttle, $D152Method_grouped, $D152Method_groupedWithin, $D152Method_groupBy, $D152Method_groupByKey, $D152Method_groupAdjacentBy, $D152Method_transduce, $D152Method_aggregate, $D152Method_aggregateWithin, $D152Method_broadcastN, $D152Method_broadcast, $D152Method_share, $D152Method_pipeThroughChannel, $D152Method_pipeThroughChannelOrFail, $D152Method_pipeThrough, $D152Method_collect, $D152Method_accumulate, $D152Method_changes, $D152Method_changesWith, $D152Method_changesWithEffect, $D152Method_decodeText, $D152Method_encodeText, $D152Method_splitLines, $D152Method_intersperse, $D152Method_intersperseAffixes, $D152Method_interleave, $D152Method_interleaveWith, $D152Method_interruptWhen, $D152Method_haltWhen, $D152Method_onExit, $D152Method_onError, $D152Method_onStart, $D152Method_onFirst, $D152Method_onEnd, $D152Method_ensuring, $D152Method_provide, $D152Method_provideContext, $D152Method_provideService, $D152Method_provideServiceEffect, $D152Method_updateContext, $D152Method_updateService, $D152Method_withSpan, $D152Method_bind, $D152Method_bindEffect, $D152Method_bindTo, $D152Method_run, $D152Method_runCollect, $D152Method_runCount, $D152Method_runSum, $D152Method_runFold, $D152Method_runFoldEffect, $D152Method_runHead, $D152Method_runLast, $D152Method_runForEach, $D152Method_runForEachWhile, $D152Method_runForEachArray, $D152Method_runDrain, $D152Method_toPull, $D152Method_mkString, $D152Method_mkArrayBuffer, $D152Method_mkUint8Array, $D152Method_toReadableStreamWith, $D152Method_toReadableStream, $D152Method_toReadableStreamEffect, $D152Method_toAsyncIterableWith, $D152Method_toAsyncIterableEffect, $D152Method_toAsyncIterable, $D152Method_runIntoPubSub, $D152Method_toPubSub, $D152Method_toPubSubTake, $D152Method_toQueue, $D152Method_runIntoQueue, $D152Method_catch, $D152Method_let {}
}

package vibelangwasm

func addEffectStubs(files map[string]any) {
	base := playgroundDir + "/node_modules/effect/"
	dist := base + "dist/"
	files[base+"package.json"] = effectPackageJSON
	files[dist+"index.d.ts"] = effectIndexDTS
	files[dist+"Effect.d.ts"] = effectModuleDTS
	files[dist+"Context.d.ts"] = contextModuleDTS
	files[dist+"Layer.d.ts"] = layerModuleDTS
	files[dist+"Data.d.ts"] = dataModuleDTS
	files[dist+"Schema.d.ts"] = schemaModuleDTS
	files[dist+"Console.d.ts"] = consoleModuleDTS
	files[dist+"Fiber.d.ts"] = fiberModuleDTS
	files[dist+"Exit.d.ts"] = exitModuleDTS
	files[dist+"Cause.d.ts"] = causeModuleDTS
	files[dist+"Duration.d.ts"] = durationModuleDTS
	files[dist+"Schedule.d.ts"] = scheduleModuleDTS
	files[dist+"Stream.d.ts"] = streamModuleDTS
	files[dist+"Scope.d.ts"] = scopeModuleDTS
	files[dist+"Equal.d.ts"] = equalModuleDTS
	files[dist+"Function.d.ts"] = functionModuleDTS
	files[dist+"Inspectable.d.ts"] = inspectableModuleDTS
	files[dist+"Ref.d.ts"] = refModuleDTS
	files[dist+"Option.d.ts"] = optionModuleDTS
}

const effectPackageJSON = `{
  "name": "effect",
  "version": "4.1.1",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts" },
    "./Effect": { "types": "./dist/Effect.d.ts" },
    "./Context": { "types": "./dist/Context.d.ts" },
    "./Layer": { "types": "./dist/Layer.d.ts" },
    "./Data": { "types": "./dist/Data.d.ts" },
    "./Schema": { "types": "./dist/Schema.d.ts" },
    "./Console": { "types": "./dist/Console.d.ts" },
    "./Fiber": { "types": "./dist/Fiber.d.ts" },
    "./Exit": { "types": "./dist/Exit.d.ts" },
    "./Cause": { "types": "./dist/Cause.d.ts" },
    "./Duration": { "types": "./dist/Duration.d.ts" },
    "./Schedule": { "types": "./dist/Schedule.d.ts" },
    "./Stream": { "types": "./dist/Stream.d.ts" },
    "./Scope": { "types": "./dist/Scope.d.ts" },
    "./Equal": { "types": "./dist/Equal.d.ts" },
    "./Function": { "types": "./dist/Function.d.ts" },
    "./Inspectable": { "types": "./dist/Inspectable.d.ts" },
    "./Ref": { "types": "./dist/Ref.d.ts" },
    "./Option": { "types": "./dist/Option.d.ts" }
  }
}`

const effectIndexDTS = `export * as Effect from "./Effect.js"
export * as Context from "./Context.js"
export * as Layer from "./Layer.js"
export * as Data from "./Data.js"
export * as Schema from "./Schema.js"
export * as Console from "./Console.js"
export * as Fiber from "./Fiber.js"
export * as Exit from "./Exit.js"
export * as Cause from "./Cause.js"
export * as Duration from "./Duration.js"
export * as Schedule from "./Schedule.js"
export * as Stream from "./Stream.js"
export * as Scope from "./Scope.js"
export * as Equal from "./Equal.js"
export * as Function from "./Function.js"
export * as Inspectable from "./Inspectable.js"
export * as Ref from "./Ref.js"
export * as Option from "./Option.js"
`

const effectModuleDTS = `import type * as Cause from "./Cause.js"
import type * as Context from "./Context.js"
import type * as Duration from "./Duration.js"
import type * as Exit from "./Exit.js"
import type * as Fiber from "./Fiber.js"
import type * as Layer from "./Layer.js"
import type * as Schedule from "./Schedule.js"
import type * as Scope from "./Scope.js"

export interface Effect<out A, out E = never, out R = never> {
  readonly "~effect/Effect": {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
    readonly _R: (_: never) => R
  }
  pipe<B>(ab: (a: this) => B): B
  pipe<B, C>(ab: (a: this) => B, bc: (b: B) => C): C
}

export declare function succeed<A>(value: A): Effect<A>
export declare function fail<E>(error: E): Effect<never, E>
export declare function die(defect: unknown): Effect<never>
export declare function sync<A>(thunk: () => A): Effect<A>
export declare function promise<A>(thunk: (signal: AbortSignal) => PromiseLike<A>): Effect<A>
export declare function try_<A>(thunk: () => A): Effect<A, unknown>
export declare function try_<A, E>(options: { readonly try: () => A; readonly catch: (error: unknown) => E }): Effect<A, E>
export { try_ as try }
export declare function tryPromise<A>(thunk: (signal: AbortSignal) => PromiseLike<A>): Effect<A, unknown>
export declare function tryPromise<A, E>(options: { readonly try: (signal: AbortSignal) => PromiseLike<A>; readonly catch: (error: unknown) => E }): Effect<A, E>
export declare function gen<A, E, R>(f: () => Generator<Effect<any, E, R>, A, any>): Effect<A, E, R>
export declare function sleep(duration: Duration.DurationInput): Effect<void>
export declare function all<const T extends ReadonlyArray<Effect<any, any, any>>>(
  effects: T,
  options?: { readonly concurrency?: number | "unbounded" | "inherit"; readonly discard?: boolean }
): Effect<
  { -readonly [K in keyof T]: T[K] extends Effect<infer A, any, any> ? A : never },
  T[number] extends Effect<any, infer E, any> ? E : never,
  T[number] extends Effect<any, any, infer R> ? R : never
>
export declare function all<const T extends Record<string, Effect<any, any, any>>>(
  effects: T,
  options?: { readonly concurrency?: number | "unbounded" | "inherit" }
): Effect<
  { -readonly [K in keyof T]: T[K] extends Effect<infer A, any, any> ? A : never },
  T[keyof T] extends Effect<any, infer E, any> ? E : never,
  T[keyof T] extends Effect<any, any, infer R> ? R : never
>
export declare function forEach<A, B, E, R>(
  items: Iterable<A>,
  f: (a: A, i: number) => Effect<B, E, R>,
  options?: { readonly concurrency?: number | "unbounded" | "inherit"; readonly discard?: boolean }
): Effect<Array<B>, E, R>
export declare function race<A, E, R, A2, E2, R2>(
  self: Effect<A, E, R>,
  that: Effect<A2, E2, R2>
): Effect<A | A2, E | E2, R | R2>
export declare function raceAll<A, E, R>(effects: Iterable<Effect<A, E, R>>): Effect<A, E, R>
export declare function raceAllFirst<A, E, R>(effects: Iterable<Effect<A, E, R>>): Effect<A, E, R>
export declare function retry<A, E, R>(self: Effect<A, E, R>, policy: Schedule.Schedule<any, any, any> | { readonly times?: number }): Effect<A, E, R>
export declare function timeout<A, E, R>(self: Effect<A, E, R>, duration: Duration.DurationInput): Effect<A, E | Cause.TimeoutException, R>
export declare function scoped<A, E, R>(self: Effect<A, E, R>): Effect<A, E, Exclude<R, Scope.Scope>>
export declare function acquireRelease<A, E, R, R2>(
  acquire: Effect<A, E, R>,
  release: (a: A, exit: Exit.Exit<unknown, unknown>) => Effect<unknown, never, R2>
): Effect<A, E, R | R2 | Scope.Scope>
export declare function ensuring<A, E, R, R2>(self: Effect<A, E, R>, finalizer: Effect<unknown, never, R2>): Effect<A, E, R | R2>
export declare function onExit<A, E, R, R2>(self: Effect<A, E, R>, cleanup: (exit: Exit.Exit<A, E>) => Effect<unknown, never, R2>): Effect<A, E, R | R2>
export declare function exit<A, E, R>(self: Effect<A, E, R>): Effect<Exit.Exit<A, E>, never, R>
export declare function withSpan<A, E, R>(self: Effect<A, E, R>, name: string): Effect<A, E, R>
export declare function provide<A, E, R, ROut, E2, RIn>(
  self: Effect<A, E, R>,
  layer: Layer.Layer<ROut, E2, RIn> | ReadonlyArray<Layer.Layer<any, any, any>>
): Effect<A, E | E2, Exclude<R, ROut> | RIn>
export declare function provideService<A, E, R, I, S>(
  self: Effect<A, E, R>,
  service: Context.Key<I, S>,
  implementation: S
): Effect<A, E, Exclude<R, I>>
export declare function forkChild<A, E, R>(self: Effect<A, E, R>): Effect<Fiber.Fiber<A, E>, never, R>
export declare function forkScoped<A, E, R>(self: Effect<A, E, R>): Effect<Fiber.Fiber<A, E>, never, R | Scope.Scope>
export declare function forkIn<A, E, R>(self: Effect<A, E, R>, scope: Scope.Scope): Effect<Fiber.Fiber<A, E>, never, R>
export declare function forkDetach<A, E, R>(self: Effect<A, E, R>): Effect<Fiber.Fiber<A, E>, never, R>
export declare function interruptible<A, E, R>(self: Effect<A, E, R>): Effect<A, E, R>
export declare function uninterruptibleMask<A, E, R>(f: (restore: <A2, E2, R2>(e: Effect<A2, E2, R2>) => Effect<A2, E2, R2>) => Effect<A, E, R>): Effect<A, E, R>
export declare function runPromise<A, E>(self: Effect<A, E, never>): Promise<A>
export declare function runSync<A, E>(self: Effect<A, E, never>): A
export declare function tap<A, E, R, E2, R2>(self: Effect<A, E, R>, f: (a: A) => Effect<unknown, E2, R2>): Effect<A, E | E2, R | R2>
export declare function map<A, E, R, B>(self: Effect<A, E, R>, f: (a: A) => B): Effect<B, E, R>
export declare function catchAll<A, E, R, A2, E2, R2>(self: Effect<A, E, R>, f: (e: E) => Effect<A2, E2, R2>): Effect<A | A2, E2, R | R2>
export declare function catchTag<A, E extends { readonly _tag: string }, R, K extends E["_tag"], A2, E2, R2>(
  self: Effect<A, E, R>,
  tag: K,
  f: (e: Extract<E, { readonly _tag: K }>) => Effect<A2, E2, R2>
): Effect<A | A2, Exclude<E, { readonly _tag: K }> | E2, R | R2>
export declare const void_: Effect<void>
export { void_ as void }
`

const contextModuleDTS = `import type * as Effect from "./Effect.js"

export interface Key<out Identifier, out Shape> extends Effect.Effect<Shape, never, Identifier> {
  readonly "~effect/Context/Key": "~effect/Context/Key"
  readonly Service: Shape
  readonly Identifier: Identifier
  readonly key: string
}

export interface Service<in out Identifier, in out Shape> extends Key<Identifier, Shape> {
  of(this: void, self: Shape): Shape
  use<A, E, R>(f: (service: Shape) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R | Identifier>
  useSync<A>(f: (service: Shape) => A): Effect.Effect<A, never, Identifier>
}

export interface Reference<in out Shape> extends Key<never, Shape> {
  readonly defaultValue: () => Shape
}

export interface ServiceClass<in out Self, in out Identifier extends string, in out Shape> extends Service<Self, Shape> {
  new (_: never): {}
  readonly key: Identifier
}

export declare function Service<Self, Shape>(): <const Identifier extends string>(key: Identifier) => (abstract new () => {}) & ServiceClass<Self, Identifier, Shape>
export declare function Reference<Shape>(key: string, options: { readonly defaultValue: () => Shape }): (abstract new () => {}) & Reference<Shape>
`

const layerModuleDTS = `import type * as Context from "./Context.js"
import type * as Effect from "./Effect.js"

export interface Layer<in ROut, out E = never, out RIn = never> {
  readonly "~effect/Layer": {
    readonly _ROut: (_: ROut) => void
    readonly _E: (_: never) => E
    readonly _RIn: (_: never) => RIn
  }
}

export type Any = Layer<any, any, any>

export declare function succeed<I, S>(service: Context.Key<I, S>, implementation: S): Layer<I>
export declare function effect<I, S, E, R>(service: Context.Key<I, S>, effect: Effect.Effect<S, E, R>): Layer<I, E, R>
export declare function merge<ROut1, E1, RIn1, ROut2, E2, RIn2>(
  left: Layer<ROut1, E1, RIn1>,
  right: Layer<ROut2, E2, RIn2>
): Layer<ROut1 | ROut2, E1 | E2, RIn1 | RIn2>
export declare function provide<ROut, E, RIn, ROut2, E2, RIn2>(
  self: Layer<ROut, E, RIn>,
  that: Layer<ROut2, E2, RIn2>
): Layer<ROut, E | E2, Exclude<RIn, ROut2> | RIn2>
export declare function provideMerge<ROut, E, RIn, ROut2, E2, RIn2>(
  self: Layer<ROut, E, RIn>,
  that: Layer<ROut2, E2, RIn2>
): Layer<ROut | ROut2, E | E2, Exclude<RIn, ROut2> | RIn2>
`

const dataModuleDTS = `export declare const TaggedError: <Tag extends string>(
  tag: Tag
) => new <A extends Record<string, any> = {}>(
  ...args: keyof A extends never ? [args?: {}] : [args: Readonly<A>]
) => Error & { readonly _tag: Tag } & Readonly<A>

export type TaggedEnum<A extends Record<string, Record<string, any>>> = {
  readonly [Tag in keyof A]: { readonly _tag: Tag } & Readonly<A[Tag]>
}[keyof A]

export interface TaggedEnumNullary<Out> {
  /** @throws {never} */
  (): Out
}

export interface TaggedEnumPayload<Args, Out> {
  /** @throws {never} */
  (args: Args): Out
}

export type TaggedEnumConstructors<A extends { readonly _tag: string }> = {
  readonly [Tag in A["_tag"]]: keyof Omit<Extract<A, { readonly _tag: Tag }>, "_tag"> extends never
    ? TaggedEnumNullary<Extract<A, { readonly _tag: Tag }>>
    : TaggedEnumPayload<Omit<Extract<A, { readonly _tag: Tag }>, "_tag">, Extract<A, { readonly _tag: Tag }>>
} & {
  readonly $is: <Tag extends A["_tag"]>(tag: Tag) => (u: unknown) => u is Extract<A, { readonly _tag: Tag }>
  readonly $match: <R>(cases: { readonly [Tag in A["_tag"]]: (v: Extract<A, { readonly _tag: Tag }>) => R }) => (value: A) => R
}

export declare function taggedEnum<A extends { readonly _tag: string }>(): TaggedEnumConstructors<A>

export declare class Class<A extends Record<string, any> = {}> {
  constructor(args: Readonly<A>)
}
`

const schemaModuleDTS = `import type * as Effect from "./Effect.js"

export interface Top {
  readonly "~effect/Schema": unknown
  readonly Type: unknown
  readonly Encoded: unknown
}

export interface Schema<out A, out I = A, out R = never> extends Top {
  readonly Type: A
  readonly Encoded: I
  readonly Context: R
}

export declare const String: Schema<string>
export declare const NonEmptyString: Schema<string>
export declare const Number: Schema<number>
export declare const Finite: Schema<number>
export declare const Int: Schema<number>
export declare const Boolean: Schema<boolean>
export declare const BigInt: Schema<bigint>
export declare const Unknown: Schema<unknown>
export declare const Any: Schema<any>
export declare const Never: Schema<never>
export declare const Null: Schema<null>
export declare const Undefined: Schema<undefined>
export declare const Void: Schema<void>
export declare const NumberFromString: Schema<number, string>
export declare const FiniteFromString: Schema<number, string>
export declare function Literal<const L extends string | number | boolean | bigint>(literal: L): Schema<L>
export declare function Literals<const L extends ReadonlyArray<string | number | boolean | bigint>>(literals: L): Schema<L[number]> & { readonly literals: L }
export declare function Struct<Fields extends Record<string, Top>>(fields: Fields): Schema<{ [K in keyof Fields]: Fields[K]["Type"] }>
export declare function TaggedStruct<Tag extends string, Fields extends Record<string, Top>>(
  tag: Tag,
  fields: Fields
): Schema<{ readonly _tag: Tag } & { [K in keyof Fields]: Fields[K]["Type"] }>
export declare function Union<const Members extends ReadonlyArray<Top>>(members: Members): Schema<Members[number]["Type"]>
export declare function Array<S extends Top>(item: S): Schema<ReadonlyArray<S["Type"]>>
export declare function mutableKey<S extends Top>(schema: S): S
export declare function optionalKey<S extends Top>(schema: S): Schema<S["Type"] | undefined>
export declare function NullOr<S extends Top>(schema: S): Schema<S["Type"] | null>
export declare function UndefinedOr<S extends Top>(schema: S): Schema<S["Type"] | undefined>
export declare function NullishOr<S extends Top>(schema: S): Schema<S["Type"] | null | undefined>
export declare function is<S extends Top>(schema: S): (u: unknown) => u is S["Type"]
export declare function decodeUnknownEffect<S extends Top>(schema: S): (u: unknown) => Effect.Effect<S["Type"], Error>
export declare function encodeEffect<S extends Top>(schema: S): (a: S["Type"]) => Effect.Effect<S["Encoded"], Error>
export declare function TaggedError<Self = never>(): <Tag extends string, Fields extends Record<string, Top>>(
  tag: Tag,
  fields: Fields
) => (new (args: { readonly [K in keyof Fields]: Fields[K]["Type"] }) => Error & { readonly _tag: Tag } & { readonly [K in keyof Fields]: Fields[K]["Type"] }) & Schema<Self>
`

const consoleModuleDTS = `import type * as Effect from "./Effect.js"
export declare function log(...args: ReadonlyArray<unknown>): Effect.Effect<void>
export declare function error(...args: ReadonlyArray<unknown>): Effect.Effect<void>
export declare function warn(...args: ReadonlyArray<unknown>): Effect.Effect<void>
export declare function info(...args: ReadonlyArray<unknown>): Effect.Effect<void>
`

const fiberModuleDTS = `import type * as Effect from "./Effect.js"
import type * as Exit from "./Exit.js"

export interface Fiber<out A, out E = never> {
  readonly "~effect/Fiber": {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
  }
}

export declare function join<A, E>(fiber: Fiber<A, E>): Effect.Effect<A, E>
export declare function await_<A, E>(fiber: Fiber<A, E>): Effect.Effect<Exit.Exit<A, E>>
export { await_ as await }
export declare function interrupt<A, E>(fiber: Fiber<A, E>): Effect.Effect<Exit.Exit<A, E>>
`

const exitModuleDTS = `import type * as Cause from "./Cause.js"

export interface Success<out A, out E = never> {
  readonly _tag: "Success"
  readonly value: A
}

export interface Failure<out A, out E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
}

export type Exit<A, E = never> = Success<A, E> | Failure<A, E>

export declare const Success: {
  <A>(value: A): Success<A>
  readonly [Symbol.hasInstance]: (u: unknown) => boolean
}
export declare const Failure: {
  <E>(cause: Cause.Cause<E>): Failure<never, E>
  readonly [Symbol.hasInstance]: (u: unknown) => boolean
}
export declare function succeed<A>(value: A): Exit<A>
export declare function fail<E>(error: E): Exit<never, E>
export declare function isSuccess<A, E>(exit: Exit<A, E>): exit is Success<A, E>
export declare function isFailure<A, E>(exit: Exit<A, E>): exit is Failure<A, E>
`

const causeModuleDTS = `export interface Cause<out E> {
  readonly _tag: string
  readonly error?: E
}
export declare class TimeoutException extends Error {
  readonly _tag: "TimeoutException"
}
`

const durationModuleDTS = `export type DurationInput = number | string | { readonly millis: number }
export declare function millis(n: number): DurationInput
export declare function seconds(n: number): DurationInput
`

const scheduleModuleDTS = `export interface Schedule<out Out, in In = unknown, out R = never> {
  readonly _Out?: Out
  readonly _In?: (_: In) => void
  readonly _R?: R
}
export declare function recurs(n: number): Schedule<number>
export declare function exponential(base: string | number): Schedule<string>
export declare function spaced(duration: string | number): Schedule<number>
`

const streamModuleDTS = `import type * as Effect from "./Effect.js"

export interface Stream<out A, out E = never, out R = never> {
  readonly "~effect/Stream": {
    readonly _A: (_: never) => A
    readonly _E: (_: never) => E
    readonly _R: (_: never) => R
  }
  readonly channel: unknown
  pipe(): unknown
}

export declare function runCollect<A, E, R>(stream: Stream<A, E, R>): Effect.Effect<ReadonlyArray<A>, E, R>
export declare function runForEach<A, E, R, E2, R2>(stream: Stream<A, E, R>, f: (a: A) => Effect.Effect<unknown, E2, R2>): Effect.Effect<void, E | E2, R | R2>
export declare function take<A, E, R>(stream: Stream<A, E, R>, n: number): Stream<A, E, R>
`

const scopeModuleDTS = `import type * as Effect from "./Effect.js"
import type * as Exit from "./Exit.js"

export interface Scope {
  readonly "~effect/Scope": unknown
}
export interface Closeable extends Scope {
  close(exit: Exit.Exit<unknown, unknown>): Effect.Effect<void>
}
export declare function make(): Effect.Effect<Closeable>
`

const equalModuleDTS = `export declare function equals(a: unknown, b: unknown): boolean`

const functionModuleDTS = `export declare function pipe<A>(a: A): A
export declare function pipe<A, B>(a: A, ab: (a: A) => B): B
export declare function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export declare function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D
export declare function identity<A>(a: A): A
`

const inspectableModuleDTS = `export declare const NodeInspectSymbol: unique symbol`

const refModuleDTS = `import type * as Effect from "./Effect.js"
export interface Ref<A> {
  readonly "~effect/Ref": unknown
}
export declare function make<A>(value: A): Effect.Effect<Ref<A>>
export declare function get<A>(ref: Ref<A>): Effect.Effect<A>
export declare function set<A>(ref: Ref<A>, value: A): Effect.Effect<void>
export declare function update<A>(ref: Ref<A>, f: (a: A) => A): Effect.Effect<void>
`

const optionModuleDTS = `export type Option<A> = { readonly _tag: "Some"; readonly value: A } | { readonly _tag: "None" }
export declare function some<A>(value: A): Option<A>
export declare function none<A = never>(): Option<A>
`

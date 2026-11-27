package vibelangwasm

func addRuntimeStubs(files map[string]any) {
	base := playgroundDir + "/node_modules/vibelang-runtime/"
	files[base+"package.json"] = runtimePackageJSON
	files[base+"index.d.ts"] = runtimeIndexDTS
	files[base+"match.d.ts"] = runtimeMatchDTS
}

const runtimePackageJSON = `{
  "name": "vibelang-runtime",
  "version": "0.0.14",
  "type": "module",
  "exports": {
    ".": { "types": "./index.d.ts" },
    "./internal": { "types": "./index.d.ts" }
  }
}`

const runtimeMatchDTS = `export declare const customMatcher: unique symbol
export declare function $is(subject: unknown, pattern: unknown): boolean
export declare function $extract(subject: unknown, matcher: unknown): ReadonlyArray<unknown> | false
export declare function $matchCache(): Map<unknown, unknown>
export declare function $relation(op: string, value: unknown): unknown
export declare function $relates(op: string, a: unknown, b: unknown): boolean
export declare function $rest(obj: Record<string, unknown>, keys: ReadonlyArray<PropertyKey>): Record<string, unknown>
export declare function $propertyKey(key: unknown): PropertyKey
export declare function $noMatch(value?: unknown): never
export declare function $patternError(message: string): never
export declare function $duplicateBinding(name: string): never
`

const runtimeIndexDTS = `import type * as Context from "effect/Context"
import type * as Data from "effect/Data"
import type * as EffectModule from "effect/Effect"
import type * as ExitModule from "effect/Exit"
import type * as Fiber from "effect/Fiber"
import type * as LayerModule from "effect/Layer"
import type * as ScopeModule from "effect/Scope"

export * as Effect from "effect/Effect"
export * as Exit from "effect/Exit"
export * as Layer from "effect/Layer"
export * as Schema from "effect/Schema"
export * as Scope from "effect/Scope"
export { pipe } from "effect/Function"
export * from "./match.js"

export type Effect<A, E = never, R = never> = EffectModule.Effect<A, E, R>
export type Scope = ScopeModule.Scope
export type ServiceKey<I, S = I> = (abstract new () => {}) & Context.Service<I, S>
export type ReferenceKey<S> = (abstract new () => {}) & Context.Reference<S>

export declare const TaggedError: typeof Data.TaggedError
export declare const $errorSubclass: <B extends abstract new (...args: any) => { readonly _tag: string }>(base: B, tag: string) => B
export type $ErrorArgs<B, A> = B extends abstract new (args: infer P) => any ? ([P] extends [void] ? {} : P) & A : never
export declare function $schemaErrorMatcher(error: abstract new (...args: any) => unknown, tag: string, privateFactoryBase?: boolean): void
export declare function $schemaErrorFamily(error: abstract new (...args: any) => unknown): void
export declare function $schemaErrorMember(error: abstract new (...args: any) => unknown): void
export declare const $global: typeof globalThis
export declare const $bindingIterators: unknown

export declare function $try<A, E, R>(effect: EffectModule.Effect<A, E, R>): A
export declare function $tryAll<const T extends ReadonlyArray<EffectModule.Effect<any, any, any>>>(
  effects: T
): EffectModule.Effect<
  { -readonly [K in keyof T]: T[K] extends EffectModule.Effect<infer A, any, any> ? A : never },
  T[number] extends EffectModule.Effect<any, infer E, any> ? E : never,
  T[number] extends EffectModule.Effect<any, any, infer R> ? R : never
>
export declare function $tryRace<const T extends ReadonlyArray<EffectModule.Effect<any, any, any>>>(
  effects: T
): EffectModule.Effect<
  T[number] extends EffectModule.Effect<infer A, any, any> ? A : never,
  T[number] extends EffectModule.Effect<any, infer E, any> ? E : never,
  T[number] extends EffectModule.Effect<any, any, infer R> ? R : never
>
export declare function $tryAny<const T extends ReadonlyArray<EffectModule.Effect<any, any, any>>>(
  effects: T
): EffectModule.Effect<
  T[number] extends EffectModule.Effect<infer A, any, any> ? A : never,
  T[number] extends EffectModule.Effect<any, infer E, any> ? E : never,
  T[number] extends EffectModule.Effect<any, any, infer R> ? R : never
>
export declare function $tryAllSettled<const T extends ReadonlyArray<EffectModule.Effect<any, any, any>>>(
  effects: T
): EffectModule.Effect<
  { -readonly [K in keyof T]: T[K] extends EffectModule.Effect<infer A, infer E, any> ? ExitModule.Exit<A, E> : never },
  never,
  T[number] extends EffectModule.Effect<any, any, infer R> ? R : never
>
export declare function $forConcurrent<A, E, R>(
  items: Iterable<A>,
  concurrency: number | "unbounded",
  body: (item: A) => EffectModule.Effect<void, E, R>
): EffectModule.Effect<void, E, R>

export declare function fork<A, E, R>(effect: EffectModule.Effect<A, E, R>): EffectModule.Effect<Fiber.Fiber<A, E>, never, R>
export declare function $forkIn<A, E, R>(scope: ScopeModule.Scope, effect: EffectModule.Effect<A, E, R>): EffectModule.Effect<Fiber.Fiber<A, E>, never, R>
export declare function $forkScoped<A, E, R>(effect: EffectModule.Effect<A, E, R>): EffectModule.Effect<Fiber.Fiber<A, E>, never, R | ScopeModule.Scope>
export declare function $forkDetach<A, E, R>(effect: EffectModule.Effect<A, E, R>): EffectModule.Effect<Fiber.Fiber<A, E>, never, R>
export declare function join<A, E>(fiber: Fiber.Fiber<A, E>): EffectModule.Effect<A, E>
export declare function $join<A, E>(fiber: Fiber.Fiber<A, E>): EffectModule.Effect<A, E>

export declare function sync<A>(thunk: () => A): EffectModule.Effect<A>
export type Resume<A, E = never> = (effect: EffectModule.Effect<A, E>) => void
export declare function callback<A, E = never>(register: (resume: Resume<A, E>) => void | EffectModule.Effect<void>): EffectModule.Effect<A, E>

export declare function $provideService<I, S>(service: Context.Key<I, S>, value: S): LayerModule.Layer<I>
export declare function $service<I, S = I>(key: string): ServiceKey<I, S>
export declare function $catchExpression<A, E, R, A2, E2, R2>(
  self: () => EffectModule.Effect<A, E, R>,
  handler: (error: E) => A2 | EffectModule.Effect<A2, E2, R2>
): EffectModule.Effect<A | A2, E2, R | R2>
export declare function $isFailure(value: unknown, tag: unknown): boolean
export declare function $failureOf<E>(cause: unknown): E
export declare function $noFailure(): never
export declare function $exit<A, E>(effect: EffectModule.Effect<A, E>): EffectModule.Effect<ExitModule.Exit<A, E>>

export declare function uninterruptible<A, E, R>(effect: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>
export declare function restore<A, E, R>(effect: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>
export declare function interruptible<A, E, R>(effect: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>
export declare function $uninterruptibleBlock<A, E, R>(body: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>
export declare function $restoreBlock<A, E, R>(body: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>
export declare function $interruptibleBlock<A, E, R>(body: EffectModule.Effect<A, E, R>): EffectModule.Effect<A, E, R>
export declare function acquireRelease<A, E, R, R2>(
  acquire: EffectModule.Effect<A, E, R>,
  release: (a: A, exit: ExitModule.Exit<unknown, unknown>) => EffectModule.Effect<unknown, never, R2>
): EffectModule.Effect<A, E, R | R2 | ScopeModule.Scope>

export declare const Experimental: Record<string, unknown>
`

import { Context, Effect, Layer } from "effect"
import * as K from "./kernel/kernel.js"

export const $Context = Context

// Infer every parameter: Layer's output is contravariant, so a layer that
// provides nothing, Layer<never, E, In>, does not extend Layer<any, any, any>,
// and a pattern with any would drop its E and In.
type LOut<L> = L extends Layer.Layer<infer O, infer _E, infer _I> ? O : never
type LErr<L> = L extends Layer.Layer<infer _O, infer E, infer _I> ? E : never
type LIn<L> = L extends Layer.Layer<infer _O, infer _E, infer I> ? I : never

// The layers of L other than the one at K.
type Others<L extends ReadonlyArray<unknown>, K> = { [J in keyof L]: J extends K ? never : L[J] }[number]

// What each layer needs that another layer does not provide. A layer cannot
// supply its own input: wire(Decorated), where Decorated provides and needs
// S, still needs S.
type Residual<L extends ReadonlyArray<unknown>> = { [K in keyof L]: Exclude<LIn<L[K]>, LOut<Others<L, K>>> }[number]

export const wire = <const L extends readonly [Layer.Any, ...Array<Layer.Any>]>(
  ...layers: L
): Layer.Layer<LOut<L[number]>, LErr<L[number]>, Residual<L>> => {
  let acc = layers[layers.length - 1] as Layer.Layer<any, any, any>
  for (let i = layers.length - 2; i >= 0; i--) acc = Layer.provideMerge(layers[i] as Layer.Layer<any, any, any>, acc)
  return acc as any
}

// ---------------------------------------------------------------------------
// Control operations and handlers (D2, D16-D18), on the continuation kernel
// ---------------------------------------------------------------------------

/** D2: control operations are abstract classes that `extend Control`; the compiler rewrites them. */
export abstract class Control {}

interface ControlInfo {
  readonly ops: Record<string, K.Operation<any, any, any>>
  readonly impl: Record<string, (...args: Array<any>) => Effect.Effect<any, any, any>>
  /** Each operation's declared parameter count, or -1 when it has a rest parameter or is unknown. */
  readonly arity: Record<string, number>
}
export const controls = new WeakMap<object, ControlInfo>()

/**
 * Registers a generated control class: one kernel operation per abstract
 * method. `arities` holds each operation's declared parameter count (-1 for a
 * rest parameter), so `handle` passes a clause its continuation after every
 * declared parameter even when a call leaves an optional argument out.
 */
export const $control = (cls: Context.Key<any, any>, methods: ReadonlyArray<string>, arities: ReadonlyArray<number> = []) => {
  const ops: Record<string, K.Operation<any, any, any>> = {}
  const impl: Record<string, (...args: Array<any>) => Effect.Effect<any, any, any>> = {}
  const arity: Record<string, number> = {}
  methods.forEach((m, i) => {
    const op = K.operation<Array<any>, any, any>(`${cls.key}.${m}`)
    ops[m] = op
    impl[m] = (...args) => op(args)
    arity[m] = arities[i] ?? -1
  })
  controls.set(cls, { ops, impl, arity })
}

/**
 * D2: the static side of a compiled control class, as its declaration file
 * names it: an Effect 4 `Context.Service` whose identifier and shape are the
 * control's interface, `ServiceKey<Approval>`, and an abstract constructor
 * with an empty instance side, so the merged interface is the class's type.
 * A service's declaration file writes Effect's own class instead (D501).
 */
export type ServiceKey<I, S = I> = (abstract new () => {}) & Context.Service<I, S>

/**
 * D40: the static side of a compiled service class that declares
 * `static readonly defaultValue = () => shape` beside other static members: a
 * `Context.Reference` of the service's shape, which needs no provider. One
 * with no other static member declares Effect's own `Context.Reference`
 * (D501).
 */
export type ReferenceKey<S> = (abstract new () => {}) & Context.Reference<S>

/**
 * D1: the base of a generated service class, Effect's own
 * `Context.Service<I, S>()(key)` (D501).
 */
export const $service = <I, S = I>(key: string): ServiceKey<I, S> =>
  Context.Service<I, S>()(key) as any

/**
 * D40: the base of a generated service class that declares
 * `static readonly defaultValue = () => shape`. Its static side is an Effect 4
 * `Context.Reference`, so a program that uses the service needs no provider:
 * the first lookup without one reads `defaultValue`, which returns the
 * class's `defaultValue()` result.
 */
export const $reference = <I>(key: string, defaultValue: () => I): ReferenceKey<I> =>
  Context.Reference<I>(key, { defaultValue }) as any

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
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

// ---------------------------------------------------------------------------
// VIP-57: schema services and worker imports
// ---------------------------------------------------------------------------

/**
 * VIP-57: the static property under which a `schema service` class carries its
 * Rpc group and the members whose transport failures stay typed. It is
 * defined non-enumerable on the class, so instances and `Object.keys` never
 * see it.
 *
 * @experimental
 * @since 0.0.14
 */
export const SchemaServiceTypeId = "~vibelang-runtime/SchemaService" as const

/**
 * VIP-57: what `$schemaService` stores on a class. `rpcs` returns the
 * compiler's generated `RpcGroup`; core keeps it untyped so it never loads
 * `effect/rpc`.
 *
 * @experimental
 * @since 0.0.14
 */
export interface SchemaServiceInfo {
  readonly key: string
  readonly rpcs: () => unknown
  /** The members whose declared error type includes Effect's `RpcClientError`. */
  readonly typedTransport: ReadonlyArray<string>
}

/**
 * VIP-57: the static side of a compiled `schema service` class: exactly a
 * `ServiceKey`, plus its `SchemaServiceInfo`.
 *
 * @experimental
 * @since 0.0.14
 */
export type SchemaServiceKey<I, S = I> = ServiceKey<I, S> & {
  readonly [SchemaServiceTypeId]: SchemaServiceInfo
}

/**
 * VIP-57: every `schema service` class this runtime has declared, by key. A
 * worker entry has only its module's default-export layer, so it finds the
 * services to serve by matching that layer's context against this registry.
 *
 * @internal
 */
export const schemaServices = new Map<string, Context.Key<any, any> & { readonly [SchemaServiceTypeId]: SchemaServiceInfo }>()

/**
 * VIP-57: the base of a generated `schema service` class. It is what
 * `$service(key)` returns, with the thunk of the compiler's `RpcGroup` and the
 * members whose declared error type includes `RpcClientError` stored under
 * `SchemaServiceTypeId`.
 *
 * @experimental
 * @since 0.0.14
 */
export const $schemaService = <I, S = I>(
  key: string,
  rpcs: () => unknown,
  typedTransport: ReadonlyArray<string> = []
): SchemaServiceKey<I, S> => {
  const service = Context.Service<I, S>()(key) as any
  const info: SchemaServiceInfo = Object.freeze({ key, rpcs, typedTransport: Object.freeze([...typedTransport]) })
  Object.defineProperty(service, SchemaServiceTypeId, { value: info, enumerable: false, writable: false, configurable: false })
  schemaServices.set(key, service)
  return service
}

/**
 * VIP-57: the property that marks a worker handle.
 *
 * @experimental
 * @since 0.0.14
 */
export const WorkerHandleTypeId = "~vibelang-runtime/WorkerHandle" as const

/**
 * VIP-57: the value of a `with { type: "worker" }` import, untyped by its
 * module's layer. `Experimental.Rpc.WorkerHandle<L>` adds that type.
 *
 * @experimental
 * @since 0.0.14
 */
export interface WorkerHandleValue {
  readonly [WorkerHandleTypeId]: typeof WorkerHandleTypeId
  /** The compiled worker module, or with `entry`, a self-contained worker entry script. */
  readonly url: URL
  /** The schema services the module's default-export layer provides. */
  readonly services: ReadonlyArray<Context.Key<any, any>>
  /** Whether `url` is already a worker entry script, as a bundler plugin writes it. */
  readonly entry: boolean
  /**
   * Starts the worker itself, for a bundler whose only worker-chunk syntax is
   * `new Worker(new URL(…, import.meta.url))`. A host calls it in place of
   * starting `url`.
   */
  readonly spawn?: ((id: number) => unknown) | undefined
}

/**
 * VIP-57: the binding of `import w from "./m.vibe" with { type: "worker" }`.
 * `url` names the compiled worker module, whose default export is a `Layer`
 * providing `services`. A bundler plugin passes `entry` `true` when `url`
 * names a bundled, self-contained worker entry instead, or passes a function
 * that starts the worker in place of the URL.
 *
 * @experimental
 * @since 0.0.14
 */
export const $worker = (
  source: URL | ((id: number) => unknown),
  services: ReadonlyArray<Context.Key<any, any>>,
  entry?: boolean
): WorkerHandleValue =>
  typeof source === "function"
    // A spawner starts a bundled entry: there is no module URL to hand a generic entry.
    ? Object.freeze({
      [WorkerHandleTypeId]: WorkerHandleTypeId,
      url: new URL("about:blank"),
      services: Object.freeze([...services]),
      entry: true,
      spawn: source
    })
    : Object.freeze({
      [WorkerHandleTypeId]: WorkerHandleTypeId,
      url: source,
      services: Object.freeze([...services]),
      entry: entry === true
    })

/**
 * D40: the base of a generated service class that declares
 * `static readonly defaultValue = () => shape`. Its static side is an Effect 4
 * `Context.Reference`, so a program that uses the service needs no provider:
 * the first lookup without one reads `defaultValue`, which returns the
 * class's `defaultValue()` result.
 */
export const $reference = <I>(key: string, defaultValue: () => I): ReferenceKey<I> =>
  Context.Reference<I>(key, { defaultValue }) as any

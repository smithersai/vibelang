/**
 * VIP-57: `schema service` declarations across a boundary. A layer decides
 * where a schema service's implementation runs: this fiber (its own layer), a
 * pool of worker threads (`workers`), or another machine (`client` here,
 * `serve` there). Everything underneath is Effect's `RpcGroup`, `RpcClient`,
 * `RpcServer` and `Worker`.
 *
 * A transport failure is a defect, unless the member's declared error type
 * includes Effect's `RpcClientError`: then the member fails with it, typed.
 *
 * @experimental
 * @since 0.0.14
 */
import * as Context from "effect/Context"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import type * as Rpc from "effect/rpc/Rpc"
import * as RpcClient from "effect/rpc/RpcClient"
import { RpcClientError } from "effect/rpc/RpcClientError"
import type * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSchema from "effect/rpc/RpcSchema"
import * as RpcServer from "effect/rpc/RpcServer"
import type * as Worker from "effect/workers/Worker"
import type * as WorkerRunner from "effect/workers/WorkerRunner"
import {
  type SchemaServiceInfo,
  SchemaServiceTypeId,
  schemaServices,
  WorkerHandleTypeId,
  type WorkerHandleValue
} from "../services.js"

declare const LayerTypeId: unique symbol

/**
 * The binding of `import w from "./m.vibe" with { type: "worker" }`, typed by
 * the module's default-export layer `L`. `$worker` builds the value.
 *
 * @since 0.0.14
 */
export interface WorkerHandle<out L> extends WorkerHandleValue {
  /** Type only: the worker module's default-export layer. */
  readonly [LayerTypeId]?: L
}

/**
 * Spawns the threads of a worker handle. Each host platform's layer provides
 * it: `ExperimentalNodeRpc.layer`, `ExperimentalBunRpc.layer` and
 * `ExperimentalBrowserRpc.layer`, which their `Experimental…Services` bundles
 * include.
 *
 * @since 0.0.14
 */
export class WorkerHost extends /* @__PURE__ */ Context.Service<WorkerHost, {
  readonly spawn: (handle: WorkerHandle<unknown>) => Layer.Layer<Worker.WorkerPlatform | Worker.Spawner>
}>()("vibelang/experimental/Rpc/WorkerHost") {}

/**
 * A pool's size: a fixed `size`, or `minSize` to `maxSize` threads that live
 * `timeToLive` when idle. `concurrency` bounds the calls each thread runs at once.
 *
 * @since 0.0.14
 */
export type PoolOptions =
  | { readonly size: number; readonly concurrency?: number | undefined }
  | {
    readonly minSize: number
    readonly maxSize: number
    readonly timeToLive: Duration.Input
    readonly concurrency?: number | undefined
  }

/** Whether a value is a worker handle. @since 0.0.14 */
export const isWorkerHandle = (u: unknown): u is WorkerHandle<unknown> =>
  typeof u === "object" && u !== null && (u as Record<PropertyKey, unknown>)[WorkerHandleTypeId] === WorkerHandleTypeId

type AnyKey = Context.Key<unknown, unknown>

const keyOf = (service: unknown): string => {
  if (typeof service === "function" || (typeof service === "object" && service !== null)) {
    const record = service as { readonly key?: unknown; readonly name?: unknown }
    return typeof record.key === "string" ? record.key : String(record.name ?? service)
  }
  return String(service)
}

const infoOf = (service: unknown, caller: string): SchemaServiceInfo => {
  const info = (service as Record<PropertyKey, unknown> | null | undefined)?.[SchemaServiceTypeId] as SchemaServiceInfo | undefined
  if (info === undefined) {
    throw new Error(`Experimental.Rpc.${caller}: ${keyOf(service)} is not a schema service; declare it with \`schema service\``)
  }
  return info
}

/**
 * The `RpcGroup` the compiler generated for a schema service, with one `Rpc`
 * per member tagged by the member's name. Throws for a class that is not a
 * schema service.
 *
 * @since 0.0.14
 */
export const group = (service: AnyKey): RpcGroup.RpcGroup<Rpc.Any> => groupOf(service, "group")

const groupOf = (service: unknown, caller: string): RpcGroup.RpcGroup<Rpc.Any> => {
  const info = infoOf(service, caller)
  const rpcs = info.rpcs() as { readonly requests?: unknown } | null | undefined
  if (rpcs === null || (typeof rpcs !== "function" && typeof rpcs !== "object") || !(rpcs.requests instanceof Map)) {
    throw new Error(`Experimental.Rpc.${caller}: the Rpc group of schema service ${info.key} is not an RpcGroup`)
  }
  return rpcs as unknown as RpcGroup.RpcGroup<Rpc.Any>
}

// One schema service at one end of a connection: its key, members and the
// tag each member has on the wire.
interface Entry {
  readonly service: AnyKey
  readonly key: string
  readonly group: RpcGroup.RpcGroup<Rpc.Any>
  readonly typedTransport: ReadonlySet<string>
  // Each member's name, wire tag, payload field names in parameter order, and kind.
  readonly members: ReadonlyArray<{
    readonly name: string
    readonly tag: string
    readonly fields: ReadonlyArray<string>
    readonly stream: boolean
  }>
}

const entryOf = (service: unknown, caller: string, namespaced: boolean): Entry => {
  const info = infoOf(service, caller)
  const base = groupOf(service, caller)
  const prefix = namespaced ? `${info.key}/` : ""
  const members: Array<Entry["members"][number]> = []
  for (const [name, rpc] of base.requests as ReadonlyMap<string, Rpc.AnyWithProps>) {
    const fields = (rpc.payloadSchema as { readonly fields?: Record<string, unknown> }).fields
    members.push({
      name,
      tag: prefix + name,
      fields: typeof fields === "object" && fields !== null ? Object.keys(fields) : [],
      stream: RpcSchema.isStreamSchema(rpc.successSchema)
    })
  }
  return {
    service: service as AnyKey,
    key: info.key,
    group: (namespaced ? base.prefix(prefix) : base) as RpcGroup.RpcGroup<Rpc.Any>,
    typedTransport: new Set(info.typedTransport),
    members
  }
}

// Every service once, by key.
const entriesOf = (services: ReadonlyArray<unknown>, caller: string, namespaced: boolean): Array<Entry> => {
  const seen = new Map<string, Entry>()
  for (const service of services) {
    const entry = entryOf(service, caller, namespaced)
    if (!seen.has(entry.key)) seen.set(entry.key, entry)
  }
  return [...seen.values()]
}

// One group with every entry's Rpcs. Tags must not collide: a server routes a
// request by its tag alone.
const mergeGroups = (entries: ReadonlyArray<Entry>, caller: string): RpcGroup.RpcGroup<Rpc.Any> => {
  const owners = new Map<string, string>()
  for (const entry of entries) {
    for (const member of entry.members) {
      const owner = owners.get(member.tag)
      if (owner !== undefined) {
        throw new Error(
          `Experimental.Rpc.${caller}: schema services ${owner} and ${entry.key} both have a member \`${member.name}\`; ` +
            "serve them from separate servers, or use Experimental.Rpc.workers, which namespaces each service's members"
        )
      }
      owners.set(member.tag, entry.key)
    }
  }
  const [first, ...rest] = entries
  return rest.length === 0 ? first.group : first.group.merge(...rest.map((entry) => entry.group))
}

const isRpcClientError = (u: unknown): u is RpcClientError => u instanceof RpcClientError

// The service's shape over an Rpc client: positional arguments become the
// payload struct keyed by parameter name. An argument that was not passed
// stays absent, so an omitted optional parameter is an absent key.
const stubOf = (entry: Entry, client: Record<string, (payload: object) => unknown>): Record<string, unknown> => {
  const shape: Record<string, unknown> = {}
  for (const member of entry.members) {
    const call = client[member.tag]
    const typed = entry.typedTransport.has(member.name)
    const { fields } = member
    shape[member.name] = (...args: Array<unknown>) => {
      const payload: Record<string, unknown> = {}
      for (let i = 0; i < fields.length && i < args.length; i++) payload[fields[i]] = args[i]
      const result = call(payload)
      if (typed) return result
      return member.stream
        ? Stream.catchIf(result as Stream.Stream<unknown, unknown>, isRpcClientError, (error) => Stream.die(error))
        : Effect.catchIf(result as Effect.Effect<unknown, unknown>, isRpcClientError, (error) => Effect.die(error))
    }
  }
  return shape
}

// The Rpc handlers of one service, calling its implementation: the payload's
// fields become positional arguments, up to the last one present.
const handlersOf = (entry: Entry): Layer.Layer<never, never, unknown> =>
  (entry.group.toLayer as unknown as (effect: Effect.Effect<Record<string, (payload: unknown) => unknown>, never, unknown>) => Layer.Layer<never, never, unknown>)(
    Effect.map(entry.service as unknown as Effect.Effect<Record<string, (...args: Array<unknown>) => unknown>, never, unknown>, (impl) => {
      const handlers: Record<string, (payload: unknown) => unknown> = {}
      for (const member of entry.members) {
        const { fields, name } = member
        handlers[member.tag] = (payload: unknown) => {
          const record = payload as Record<string, unknown> | null
          let count = fields.length
          while (count > 0 && !(record !== null && typeof record === "object" && fields[count - 1] in record)) count--
          const args = fields.slice(0, count).map((field) => record![field])
          return impl[name](...args)
        }
      }
      return handlers
    })
  )

const clientLayer = (entries: ReadonlyArray<Entry>, merged: RpcGroup.RpcGroup<Rpc.Any>) =>
  Layer.effectContext(Effect.map(RpcClient.make(merged), (client) =>
    Context.makeUnsafe<never>(new Map(entries.map((entry) => [entry.key, stubOf(entry, client as unknown as Record<string, (payload: object) => unknown>)])))
  ))

const serverLayer = (entries: ReadonlyArray<Entry>, merged: RpcGroup.RpcGroup<Rpc.Any>): Layer.Layer<never, never, unknown> => {
  const [first, ...rest] = entries.map(handlersOf)
  return RpcServer.layer(merged).pipe(Layer.provide(Layer.mergeAll(first, ...rest))) as unknown as Layer.Layer<never, never, unknown>
}

// Builds a layer at construction time, so that a class that is not a schema
// service is a defect of the layer, not an exception at the call.
const defer = <A, R>(build: () => Layer.Layer<A, unknown, R>): Layer.Layer<A, never, R> =>
  Layer.orDie(Layer.unwrap(Effect.sync(build)))

type Identifier<S> = S extends Context.Key<infer I, infer _S> ? I : never

/**
 * A layer that provides `service` by calling a server over the provided
 * `RpcClient.Protocol`. Tags are the group's own, so a hand-written Effect
 * server of the same `RpcGroup` answers it. A class that is not a schema
 * service is a defect.
 *
 * @since 0.0.14
 */
export const client = <I, S>(service: Context.Key<I, S>): Layer.Layer<I, never, RpcClient.Protocol> =>
  defer(() => {
    const entries = entriesOf([service], "client", false)
    return clientLayer(entries, mergeGroups(entries, "client"))
  }) as unknown as Layer.Layer<I, never, RpcClient.Protocol>

/**
 * A layer that serves `services` from their implementations in context over
 * the provided `RpcServer.Protocol`. Tags are each group's own; two services
 * that share a member name are a defect. A class that is not a schema service
 * is a defect.
 *
 * @since 0.0.14
 */
export const serve = <S extends AnyKey, const Rest extends ReadonlyArray<AnyKey>>(
  service: S,
  ...services: Rest
): Layer.Layer<never, never, Identifier<S | Rest[number]> | RpcServer.Protocol> =>
  defer(() => {
    const entries = entriesOf([service, ...services], "serve", false)
    return serverLayer(entries, mergeGroups(entries, "serve"))
  }) as unknown as Layer.Layer<never, never, Identifier<S | Rest[number]> | RpcServer.Protocol>

/**
 * A layer that provides every service of a worker module from a pool of its
 * threads. The pool's scope owns the threads and ends them when it closes.
 * Each service's members are namespaced by its key on the wire, so services in
 * one worker may share member names. A pool that cannot start is a defect.
 *
 * @since 0.0.14
 */
export const workers = <ROut, E, RIn>(
  worker: WorkerHandle<Layer.Layer<ROut, E, RIn>>,
  options: PoolOptions
): Layer.Layer<ROut, never, WorkerHost> =>
  Layer.orDie(Layer.unwrap(Effect.map(WorkerHost, (host) => {
    if (!isWorkerHandle(worker)) throw new Error("Experimental.Rpc.workers: expected the binding of a `with { type: \"worker\" }` import")
    const entries = entriesOf(worker.services, "workers", true)
    if (entries.length === 0) throw new Error(`Experimental.Rpc.workers: ${worker.url.href} provides no schema service`)
    return clientLayer(entries, mergeGroups(entries, "workers")).pipe(
      Layer.provide(RpcClient.layerProtocolWorker(options)),
      Layer.provide(host.spawn(worker))
    )
  }))) as unknown as Layer.Layer<ROut, never, WorkerHost>

/**
 * What a worker entry runs: builds `layer` and serves its schema services
 * over the worker runner, with each service's members namespaced by its key as
 * `workers` calls them. With no `services`, it serves every schema service the
 * built layer provides. A layer that fails to build, or provides no schema
 * service, is a defect.
 *
 * @since 0.0.14
 */
export const serveWorker = <ROut, E, RIn>(
  layer: Layer.Layer<ROut, E, RIn>,
  services?: ReadonlyArray<AnyKey>
): Layer.Layer<never, never, RIn | WorkerRunner.WorkerRunnerPlatform> =>
  Layer.orDie(Layer.unwrap(Effect.map(Layer.build(layer), (context) => {
    const found = services ?? discover(context)
    if (found.length === 0) throw new Error("Experimental.Rpc.serveWorker: the worker module's layer provides no schema service")
    const entries = entriesOf(found, "serveWorker", true)
    return serverLayer(entries, mergeGroups(entries, "serveWorker")).pipe(
      Layer.provide(Layer.succeedContext(context)),
      Layer.provide(RpcServer.layerProtocolWorkerRunner)
    )
  }))) as unknown as Layer.Layer<never, never, RIn | WorkerRunner.WorkerRunnerPlatform>

// The schema services a built context provides, in its order.
const discover = (context: Context.Context<never>): Array<AnyKey> => {
  const found: Array<AnyKey> = []
  for (const key of context.mapUnsafe.keys()) {
    const service = schemaServices.get(key)
    if (service !== undefined) found.push(service)
  }
  return found
}

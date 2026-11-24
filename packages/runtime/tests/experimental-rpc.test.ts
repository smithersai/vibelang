// VIP-57: `schema service` and worker imports. The fixtures in
// fixtures/rpc-stats.mjs are the compiler's output, written by hand.
import { expect, test } from "bun:test"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as RpcClient from "effect/rpc/RpcClient"
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError"
import * as RpcServer from "effect/rpc/RpcServer"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { $schemaService, $service, $worker } from "vibelang-runtime/internal"
import * as Public from "vibelang-runtime"
import { Rpc } from "vibelang-runtime/experimental"
import { ExperimentalBrowserRpc, ExperimentalBrowserServices } from "vibelang-runtime/experimental/platform-browser"
import { ExperimentalBunRpc, ExperimentalBunServices } from "vibelang-runtime/experimental/platform-bun"
import { ExperimentalNodeRpc, ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"
import { EmptySample, Labels, LabelsLive, Stats, StatsLive, StatsRpcs } from "./fixtures/rpc-stats.mjs"

const SchemaServiceTypeId = "~vibelang-runtime/SchemaService"

// A client and a server protocol joined in memory. Messages are cloned, as a
// transport copies them; `fault.on` makes every client send fail as a
// transport does.
const memory = (fault: { on: boolean }) =>
  Layer.effectContext(Effect.gen(function*() {
    let toServer!: (clientId: number, data: any) => Effect.Effect<void>
    let toClient!: (clientId: number, data: any) => Effect.Effect<void>
    const disconnects = yield* Queue.make<number>()
    const clientIds = new Set<number>()
    const server = yield* RpcServer.Protocol.make((write) => {
      toServer = write
      return Effect.succeed({
        disconnects,
        send: (clientId: number, response: any) => Effect.suspend(() => toClient(clientId, structuredClone(response))),
        end: () => Effect.void,
        clientIds: Effect.sync(() => clientIds),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: false,
        supportsNotifications: false,
        codecFor: Schema.toCodecJson
      })
    })
    const client = yield* RpcClient.Protocol.make((write) => {
      toClient = write
      return Effect.succeed({
        send: (clientId: number, request: any) =>
          fault.on
            ? Effect.fail(new RpcClientError({ reason: new RpcClientDefect({ message: "link down", cause: "link down" }) }))
            : Effect.suspend(() => {
              clientIds.add(clientId)
              return toServer(clientId, structuredClone(request))
            }),
        supportsAck: true,
        supportsTransferables: false,
        codecFor: Schema.toCodecJson
      })
    })
    return Context.add(Context.make(RpcServer.Protocol, server), RpcClient.Protocol, client)
  }))

// `Stats` from a server over the in-memory protocols.
const remote = (fault = { on: false }) =>
  Layer.merge(Rpc.client(Stats), Rpc.serve(Stats).pipe(Layer.provide(StatsLive))).pipe(Layer.provide(memory(fault)))

const run = <A, E>(effect: Effect.Effect<A, E, any>, layer: Layer.Layer<any, any, any>) =>
  Effect.runPromise(Effect.exit(Effect.provide(effect, layer) as Effect.Effect<A, E>))

const defectOf = (exit: Exit.Exit<unknown, unknown>): unknown => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (!Exit.isFailure(exit)) return undefined
  const die = exit.cause.reasons.find(Cause.isDieReason)
  expect(die, `expected a defect, got ${Cause.pretty(exit.cause)}`).toBeDefined()
  return die?.defect
}

test("$schemaService is $service plus the group thunk and typed-transport list", async () => {
  class Plain extends $service<Plain, { readonly n: number }>("test/rpc#Plain") {}
  expect(Stats.key).toBe("test/rpc-stats#Stats")
  expect(Object.keys(Stats)).toEqual(Object.keys(Plain))
  expect(Object.getOwnPropertyNames(Object.getPrototypeOf(Stats))).toContain(SchemaServiceTypeId)
  expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Stats), SchemaServiceTypeId)?.enumerable).toBe(false)
  const info = (Stats as any)[SchemaServiceTypeId]
  expect(info.key).toBe("test/rpc-stats#Stats")
  expect(info.rpcs()).toBe(StatsRpcs)
  expect(info.typedTransport).toEqual(["probe"])
  expect((Labels as any)[SchemaServiceTypeId].typedTransport).toEqual([])
  expect(Rpc.group(Stats)).toBe(StatsRpcs)
  // A local layer runs in-process, as for any service.
  const exit = await run(Effect.flatMap((Stats as Effect.Effect<any>), (stats: any) => stats.summarize([2, 4])), StatsLive)
  expect(exit).toEqual(Exit.succeed({ mean: 3, max: 4 }))
  // The public root and the compiler entry export the same helpers.
  expect(Public.$schemaService).toBe($schemaService)
  expect(Public.$worker).toBe($worker)
})

test("$worker returns a frozen handle; a bundler's entry flag is a boolean", () => {
  const url = new URL("./fixtures/rpc-stats.mjs", import.meta.url)
  const handle = $worker(url, [Stats, Labels])
  expect(Object.isFrozen(handle)).toBe(true)
  expect(Object.isFrozen(handle.services)).toBe(true)
  expect(handle.url).toBe(url)
  expect(handle.services).toEqual([Stats, Labels])
  expect(handle.entry).toBe(false)
  expect($worker(url, [Stats], true).entry).toBe(true)
  // A spawner in place of the URL starts a bundled entry itself.
  const spawn = () => undefined
  const spawned = $worker(spawn, [Stats], true)
  expect(spawned.spawn).toBe(spawn)
  expect(spawned.entry).toBe(true)
  expect(handle.spawn).toBeUndefined()
  expect(Rpc.isWorkerHandle(handle)).toBe(true)
  expect(Rpc.isWorkerHandle({ url })).toBe(false)
})

test("serve and client round-trip: typed error, optional parameters, no parameters, streams", async () => {
  const exit = await run(Effect.gen(function*() {
    const stats: any = yield* Stats
    return {
      summary: yield* stats.summarize([1, 2, 3, 6]),
      empty: yield* Effect.flip(stats.summarize([])),
      arity: [yield* stats.arity(), yield* stats.arity(1), yield* stats.arity(1, 2)],
      thread: yield* stats.thread(),
      reset: yield* stats.reset(),
      ticks: yield* Stream.runCollect(stats.ticks(3)),
      tickError: yield* Effect.flip(Stream.runCollect(stats.ticks(-1)))
    }
  }), remote())
  expect(Exit.isSuccess(exit)).toBe(true)
  if (!Exit.isSuccess(exit)) return
  const value = exit.value as any
  expect(value.summary).toEqual({ mean: 3, max: 6 })
  expect(value.empty).toBeInstanceOf(EmptySample)
  expect(value.arity).toEqual([0, 1, 2])
  expect(typeof value.thread).toBe("number")
  expect(value.reset).toBeUndefined()
  expect(value.ticks).toEqual([1, 2, 3])
  expect(value.tickError).toBeInstanceOf(EmptySample)
})

test("client interoperates with a hand-written Effect server of the same group", async () => {
  const handwritten = RpcServer.layer(StatsRpcs).pipe(Layer.provide(StatsRpcs.toLayer({
    summarize: ({ values }: { values: ReadonlyArray<number> }) => Effect.succeed({ mean: values.length, max: -1 }),
    ticks: ({ n }: { n: number }) => Stream.make(n),
    arity: (payload: object) => Effect.succeed(Object.keys(payload).length * 10),
    thread: () => Effect.succeed(7),
    slow: () => Effect.succeed(0),
    probe: () => Effect.succeed(0),
    reset: () => Effect.void
  } as any)))
  const layer = Layer.merge(Rpc.client(Stats), handwritten).pipe(Layer.provide(memory({ on: false })))
  const exit = await run(Effect.gen(function*() {
    const stats: any = yield* Stats
    return [yield* stats.summarize([5, 5]), yield* stats.arity(1), yield* stats.arity(), yield* Stream.runCollect(stats.ticks(4))]
  }), layer)
  expect(exit).toEqual(Exit.succeed([{ mean: 2, max: -1 }, 10, 0, [4]]))
})

test("a transport failure is a defect, unless the member lists RpcClientError", async () => {
  const fault = { on: true }
  const layer = remote(fault)
  const ordinary = await run(Effect.flatMap((Stats as Effect.Effect<any>), (stats: any) => stats.thread()), layer)
  expect(defectOf(ordinary)).toBeInstanceOf(RpcClientError)
  const stream = await run(Effect.flatMap((Stats as Effect.Effect<any>), (stats: any) => Stream.runCollect(stats.ticks(2))), layer)
  expect(defectOf(stream)).toBeInstanceOf(RpcClientError)
  const typed = await run(Effect.flatMap((Stats as Effect.Effect<any>), (stats: any) => Effect.flip(stats.probe())), layer)
  expect(Exit.isSuccess(typed)).toBe(true)
  if (Exit.isSuccess(typed)) expect(typed.value).toBeInstanceOf(RpcClientError)
  // The same members succeed once the link is up.
  fault.on = false
  expect(await run(Effect.flatMap((Stats as Effect.Effect<any>), (stats: any) => stats.probe()), remote(fault))).toEqual(Exit.succeed(1))
})

test("a class that is not a schema service is a clear defect", async () => {
  class Plain extends $service<Plain, { readonly n: number }>("test/rpc#Plain") {}
  const message = /test\/rpc#Plain is not a schema service; declare it with `schema service`/
  const client = await run(Effect.void, Rpc.client(Plain).pipe(Layer.provide(memory({ on: false }))))
  expect(String((defectOf(client) as Error).message)).toMatch(message)
  const serve = await run(Effect.void, Rpc.serve(Plain).pipe(Layer.provide(memory({ on: false })), Layer.provide(Layer.succeed(Plain, { n: 1 }))))
  expect(String((defectOf(serve) as Error).message)).toMatch(message)
  expect(() => Rpc.group(Plain)).toThrow(message)
  const pool = await run(Effect.void, Rpc.workers($worker(new URL("file:///none.js"), [Plain]) as any, { size: 1 }).pipe(Layer.provide(ExperimentalNodeRpc.layer)))
  expect(String((defectOf(pool) as Error).message)).toMatch(message)
})

test("serving two services that share a member name together is a clear defect", async () => {
  const exit = await run(Effect.void, Rpc.serve(Stats, Labels, Stats).pipe(
    Layer.provide(Layer.merge(StatsLive, LabelsLive)),
    Layer.provide(memory({ on: false }))
  ))
  // Stats and Labels both have `thread`; the repeated Stats is served once.
  expect(String((defectOf(exit) as Error).message)).toMatch(
    /schema services test\/rpc-stats#Stats and test\/rpc-stats#Labels both have a member `thread`/
  )
})

test("every platform provides Rpc.WorkerHost, in its layer and its services bundle", async () => {
  for (const layer of [
    ExperimentalNodeRpc.layer,
    ExperimentalBunRpc.layer,
    ExperimentalBrowserRpc.layer,
    ExperimentalNodeServices.layer,
    ExperimentalBunServices.layer
  ] as Array<Layer.Layer<any>>) {
    const exit = await run(Effect.map(Rpc.WorkerHost, (host) => typeof host.spawn), layer)
    expect(exit).toEqual(Exit.succeed("function"))
  }
  // The browser bundle's other services need a DOM; its layer list is checked by type.
  const browser: Layer.Layer<Rpc.WorkerHost> = ExperimentalBrowserServices.layer
  expect(Layer.isLayer(browser)).toBe(true)
  expect(typeof ExperimentalNodeRpc.runWorker).toBe("function")
  expect(typeof ExperimentalBunRpc.runWorker).toBe("function")
  expect(typeof ExperimentalBrowserRpc.runWorker).toBe("function")
})

// Node's host spawns node:worker_threads; Bun's spawns Bun workers.
for (const [platform, executable] of [["node", "node"], ["bun", process.execPath]] as const) {
test(`a real ${platform} worker pool: two services, shared member names, concurrency, and teardown`, () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-rpc-"))
  try {
    const host = fileURLToPath(new URL("./fixtures/rpc-host.mjs", import.meta.url))
    const result = Bun.spawnSync([executable, host, join(dir, "log"), platform], { timeout: 30_000 })
    const stdout = result.stdout.toString()
    const stderr = result.stderr.toString()
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    const report = JSON.parse(stdout.trim().split("\n").at(-1)!)
    for (const kind of ["module", "entry", "spawn"] as const) {
      const calls = report[kind]
      const log: Array<string> = report[`${kind}Log`]
      expect(calls.summary).toEqual({ mean: 3, max: 6 })
      expect(calls.empty).toBe("EmptySample")
      expect(calls.emptyIsClass).toBe(true)
      expect(calls.arity).toEqual([0, 1, 2])
      expect(calls.ticks).toEqual([1, 2, 3])
      expect(calls.tickError).toBe("EmptySample")
      // Both services ran on a worker thread, not the main one.
      expect(calls.statsThread).not.toBe(report.mainThread)
      expect(calls.label).toMatch(/^labels:\d+$/)
      expect(Number(calls.label.slice("labels:".length))).not.toBe(report.mainThread)
      // Two calls ran at once on two threads of the pool.
      expect(new Set(calls.slow).size).toBe(2)
      expect(calls.elapsed).toBeLessThan(750)
      // Every started thread released its layer when the pool's scope closed.
      const started = log.filter((line) => line.startsWith("start ")).map((line) => line.slice(6)).sort()
      const stopped = log.filter((line) => line.startsWith("stop ")).map((line) => line.slice(5)).sort()
      expect(started.length).toBe(2)
      expect(stopped).toEqual(started)
      expect(started).toContain(String(calls.statsThread))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 40_000)
}

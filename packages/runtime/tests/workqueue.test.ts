import { expect, test } from "bun:test"
import fc from "fast-check"
import { Context, Effect, Exit, Fiber, Layer, Schema, Scope } from "effect"
import { PersistedQueue } from "effect/persistence"
import { TestClock } from "effect/testing"
import { WorkflowEngine } from "effect/workflow"
import { Durable, WorkQueue } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { layerCrypto, settle } from "./support/webcrypto.ts"

// The outside world a handler changes, and the injected fault: the first
// `interrupts` deliveries of each page are interrupted before they finish,
// and a page named "hang" never finishes while `frozen` holds.
interface World {
  readonly handled: Array<string>
  readonly deliveries: Map<string, number>
  interrupts: number
  frozen: boolean
}
const Outside = Context.Service<World>("test/WorkQueue/Outside")

const world = (interrupts = 0): World => ({ handled: [], deliveries: new Map(), interrupts, frozen: false })

const Renders = WorkQueue.make("Renders", {
  payload: { page: Schema.String },
  success: Schema.String,
  error: Schema.Struct({ reason: Schema.String }),
  key: (job) => job.page
})

const render = ({ page }: { readonly page: string }) =>
  Effect.gen(function*() {
    const outside = yield* Outside
    const delivery = (outside.deliveries.get(page) ?? 0) + 1
    outside.deliveries.set(page, delivery)
    if (delivery <= outside.interrupts) return yield* Effect.interrupt
    if (page === "hang" && outside.frozen) return yield* Effect.never
    if (page === "bad") return yield* Effect.fail({ reason: `cannot render ${page}` })
    outside.handled.push(page)
    return `<html>${page}</html>`
  })

const Render = Durable.workflow("test#Render", {
  payload: { pages: Schema.Array(Schema.String) },
  success: Schema.Array(Schema.String),
  error: Schema.Struct({ reason: Schema.String })
})

const RenderLive = Render.toLayer(({ pages }) => Effect.forEach(pages, (page) => WorkQueue.process(Renders, { page })))

interface Stores {
  readonly durable: Durable.Store
  readonly queues: Context.Context<PersistedQueue.PersistedQueueStore>
  readonly world: World
}

// One host: an engine, the queue factory over the shared queue store, and optionally a worker.
const host = (stores: Stores, options: { readonly worker?: boolean; readonly concurrency?: number } = {}) => {
  const engine = Layer.mergeAll(RenderLive, Layer.succeed(Outside, stores.world)).pipe(
    Layer.provideMerge(Durable.layerStore(stores.durable)),
    Layer.provideMerge(PersistedQueue.layer.pipe(Layer.provide(Layer.succeedContext(stores.queues))))
  )
  if (options.worker === false) return engine
  return WorkQueue.worker(Renders, render, { concurrency: options.concurrency ?? 2 }).pipe(Layer.provideMerge(engine))
}

const makeStores = (interrupts = 0) =>
  Effect.map(Layer.build(PersistedQueue.layerStoreMemory), (queues): Stores => ({ durable: Durable.makeMemoryStore(), queues, world: world(interrupts) }))

const start = (layer: Layer.Layer<any, any>) =>
  Effect.gen(function*() {
    const scope = yield* Scope.make()
    const context = yield* Layer.buildWithScope(layer, scope)
    return { scope, context }
  })

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(layerCrypto)) as Effect.Effect<A, E>)

const execute = (pages: ReadonlyArray<string>) => Render.execute({ pages })

test("process parks the run and resumes it with the worker's result", async () => {
  const result = await run(Effect.gen(function*() {
    const stores = yield* makeStores()
    const { context } = yield* start(host(stores))
    const html = yield* Effect.provideContext(execute(["home", "about"]), context)
    return { html, handled: stores.world.handled }
  }))
  expect(result).toEqual({ html: ["<html>home</html>", "<html>about</html>"], handled: ["home", "about"] })
})

test("a handler's typed failure fails the waiting run with it", async () => {
  const exit = await run(Effect.gen(function*() {
    const stores = yield* makeStores()
    const { context } = yield* start(host(stores))
    return yield* Effect.exit(Effect.provideContext(execute(["bad"]), context))
  }))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(JSON.stringify(exit)).toContain("cannot render bad")
})

test("two offers with one key in a run are two items; a replay derives the same items", async () => {
  await run(Effect.gen(function*() {
    const stores = yield* makeStores()
    // The first host has no worker: the run offers its first item and parks.
    const first = yield* start(host(stores, { worker: false }))
    const id = yield* Effect.provideContext(Render.executionId({ pages: ["home", "home"] }), first.context)
    yield* Effect.provideContext(Render.execute({ pages: ["home", "home"] }, { discard: true }), first.context)
    yield* settle
    yield* Scope.close(first.scope, Exit.void)
    // A second host with a worker resumes the run: its replay offers the same first item, which is not offered twice.
    const second = yield* start(host(stores))
    const html = yield* Effect.provideContext(Durable.run(Render, id).result, second.context)
    expect(html).toEqual(["<html>home</html>", "<html>home</html>"])
    expect(stores.world.handled).toEqual(["home", "home"])
  }))
})

test("a parked run shows the waiting reason event, named after the queue, until the worker answers", async () => {
  await run(Effect.gen(function*() {
    const stores = yield* makeStores()
    const first = yield* start(host(stores, { worker: false }))
    const id = yield* Effect.provideContext(Render.executionId({ pages: ["home"] }), first.context)
    yield* Effect.provideContext(Render.execute({ pages: ["home"] }, { discard: true }), first.context)
    yield* settle
    const parked = yield* Effect.provideContext(Durable.waiting(id), first.context)
    expect(parked.map(({ reason, name }) => ({ reason, name }))).toEqual([{ reason: "event", name: "Renders" }])
    expect(parked[0]!.token).toBeString()
    yield* Scope.close(first.scope, Exit.void)
    const second = yield* start(host(stores))
    yield* Effect.provideContext(Durable.run(Render, id).result, second.context)
    expect(yield* Effect.provideContext(Durable.waiting(id), second.context)).toEqual([])
  }))
})

test("an interrupted handler records nothing and the item is delivered again", async () => {
  const result = await run(Effect.gen(function*() {
    const stores = yield* makeStores(12)
    const { context } = yield* start(host(stores, { concurrency: 1 }))
    const html = yield* Effect.provideContext(execute(["home"]), context)
    return { html, deliveries: stores.world.deliveries.get("home"), handled: stores.world.handled }
  }))
  expect(result).toEqual({ html: ["<html>home</html>"], deliveries: 13, handled: ["home"] })
})

test("a completion the engine refuses is a failed delivery, retried past Effect's ten attempts: the item is never dropped", async () => {
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const stores = yield* makeStores()
    const engine = yield* start(host(stores, { worker: false }))
    // The injected fault: the worker's engine refuses to record the first 12 handler exits.
    const refusals = { left: 12 }
    const faulty = Layer.effect(
      WorkflowEngine.WorkflowEngine,
      Effect.map(Effect.service(WorkflowEngine.WorkflowEngine), (real) => ({
        ...real,
        deferredDone: ((...args: Parameters<typeof real.deferredDone>) =>
          refusals.left-- > 0 ? Effect.die(new Error("the store refused the write")) : real.deferredDone(...args)) as typeof real.deferredDone
      }))
    )
    yield* start(WorkQueue.worker(Renders, render, { concurrency: 1 }).pipe(Layer.provide(faulty), Layer.provide(Layer.succeedContext(engine.context))))
    const waiting = yield* Effect.forkChild(Effect.provideContext(execute(["home"]), engine.context))
    // Each failed delivery waits Effect's backoff, from 1 second up to 5 minutes.
    for (let step = 0; step < 30 && waiting.pollUnsafe() === undefined; step++) {
      yield* TestClock.adjust("5 minutes")
      yield* settle
    }
    // A dropped item leaves the run parked for good.
    expect(waiting.pollUnsafe()).toBeDefined()
    const html = yield* Fiber.join(waiting)
    return { html, deliveries: stores.world.deliveries.get("home"), refusals: refusals.left }
  })).pipe(Effect.provide(TestClock.layer()), Effect.provide(layerCrypto)))
  // Until its exit is recorded the handler runs again: 12 refused, the 13th recorded.
  expect(result).toEqual({ html: ["<html>home</html>"], deliveries: 13, refusals: -1 })
})

test("a worker that dies before recording the exit leaves the item to another worker, which runs the handler again", async () => {
  await run(Effect.gen(function*() {
    const stores = yield* makeStores()
    stores.world.frozen = true
    const first = yield* start(host(stores, { concurrency: 1 }))
    yield* Effect.provideContext(Render.execute({ pages: ["hang"] }, { discard: true }), first.context)
    const id = yield* Effect.provideContext(Render.executionId({ pages: ["hang"] }), first.context)
    yield* settle
    expect(stores.world.deliveries.get("hang")).toBe(1)
    yield* Scope.close(first.scope, Exit.void)
    stores.world.frozen = false
    const second = yield* start(host(stores, { concurrency: 1 }))
    const html = yield* Effect.provideContext(Durable.run(Render, id).result, second.context)
    expect(html).toEqual(["<html>hang</html>"])
    expect(stores.world.deliveries.get("hang")).toBe(2)
  }))
})

test("a worker with a concurrency below 1 dies when it starts, so nothing is answered", async () => {
  const exit = await run(Effect.gen(function*() {
    const stores = yield* makeStores()
    const layer = WorkQueue.worker(Renders, render, { concurrency: 0 }).pipe(Layer.provideMerge(host(stores, { worker: false })))
    const { context } = yield* start(layer)
    return yield* Effect.exit(Effect.provideContext(Effect.timeout(execute(["home"]), "50 millis"), context))
  }))
  expect(Exit.isFailure(exit)).toBe(true)
})

interface Delivery {
  readonly interrupts: number
  readonly pages: ReadonlyArray<string>
  readonly concurrency: number
}

const deliveredAtLeastOnce = async ({ interrupts, pages, concurrency }: Delivery) => {
  await run(Effect.gen(function*() {
    const stores = yield* makeStores(interrupts)
    const { context } = yield* start(host(stores, { concurrency }))
    const html = yield* Effect.provideContext(execute(pages), context)
    // Every offer gets its own answer, in order, and each item's handler finished once.
    expect(html).toEqual(pages.map((page) => `<html>${page}</html>`))
    expect([...stores.world.handled].sort()).toEqual([...pages].sort())
  }))
}

test("property: every item is delivered at least once and answered once", async () => {
  await checkProperty(fc, {
    name: "workqueue-at-least-once",
    rule: "VIP-61: the queue never drops an item; a delivery that could not start is redelivered",
    command: "bun test tests/workqueue.test.ts",
    arbitrary: fc.record({
      interrupts: fc.integer({ min: 0, max: 15 }),
      pages: fc.array(fc.constantFrom("home", "about", "blog"), { minLength: 1, maxLength: 5 }),
      concurrency: fc.integer({ min: 1, max: 3 })
    }),
    numRuns: 40,
    check: deliveredAtLeastOnce
  })
}, 60000)

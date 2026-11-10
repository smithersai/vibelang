import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Redacted, Schema } from "effect"
import { DurableDeferred } from "effect/workflow"
import { Durable } from "vibelang-runtime/experimental"

// A real store whose reads take time, as a network database's do. The memory
// store answers synchronously, which hides interleavings across a read.
const withLatency = (store: Durable.Store): Durable.Store => ({
  ...store,
  get: (run) => Effect.delay(store.get(run), "2 millis"),
  entries: (run, range) => Effect.delay(store.entries(run, range), "2 millis")
})

const failure = (exit: Exit.Exit<unknown, unknown>) => Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""

test("two resumes of one run at once start its body once", async () => {
  const store = withLatency(Durable.makeMemoryStore())
  let calls = 0
  const Go = DurableDeferred.make("go")
  const After = Durable.task("race#After", { payload: {}, success: Schema.Number })
  const W = Durable.workflow("race#Wait", { payload: { id: Schema.String }, success: Schema.Number })
  const layer = W.toLayer(() => Effect.andThen(DurableDeferred.await(Go), After({}))).pipe(
    Layer.provide(After.toLayer(() => Effect.andThen(Effect.sleep("10 millis"), Effect.sync(() => ++calls)))),
    Layer.provideMerge(Durable.layerStore(store))
  )
  const result = await Effect.runPromise(Effect.gen(function*() {
    const id = yield* W.executionId({ id: "a" })
    yield* W.execute({ id: "a" }, { discard: true })
    yield* Effect.sleep("20 millis")
    // The signal arrives from another process: it is in the store, and
    // nothing in this engine wakes the run. Then two resumes race.
    yield* store.append(id, [{ eventType: "DeferredDone", payload: { name: "go", exit: { _tag: "Success", value: null } } }], 0)
    yield* Effect.all([W.resume(id), W.resume(id)], { concurrency: "unbounded" })
    yield* Effect.sleep("50 millis")
    return yield* Durable.run(W, id).result
  }).pipe(Effect.provide(layer)))
  expect(result).toBe(1)
  expect(calls).toBe(1)
})

const Fetch = Durable.task("race#Fetch", { payload: {}, success: Schema.Number })
const planned = (version: string) =>
  Durable.workflow("race#Planned", { payload: { id: Schema.String }, success: Schema.Number, plan: () => ({ nodes: [{ key: version }] }) })

test("a rewind to before the plan record re-records the plan, and the run resumes", async () => {
  const store = Durable.makeMemoryStore()
  const W = planned("v1")
  const layer = W.toLayer(() => Fetch({})).pipe(
    Layer.provide(Fetch.toLayer(() => Effect.succeed(5))),
    Layer.provideMerge(Durable.layerStore(store))
  )
  const out = await Effect.runPromise(Effect.gen(function*() {
    yield* W.execute({ id: "b" })
    const id = yield* W.executionId({ id: "b" })
    yield* Durable.rewind({ run: id, seq: 2 })
    const again = yield* W.execute({ id: "b" })
    const copy = yield* Durable.fork({ run: id, seq: 2 })
    return [again, yield* Durable.run(W, copy.run).result]
  }).pipe(Effect.provide(layer)))
  expect(out).toEqual([5, 5])
})

test("an engine refused for a changed plan takes no claim on the run", async () => {
  const store = Durable.makeMemoryStore()
  const hold = Deferred.makeUnsafe<void>()
  const entered = Deferred.makeUnsafe<void>()
  const layer = (version: string, blocking: boolean) => {
    const W = planned(version)
    return {
      W,
      layer: W.toLayer(() => Fetch({})).pipe(
        Layer.provide(Fetch.toLayer(() =>
          blocking ? Deferred.succeed(entered, void 0).pipe(Effect.andThen(Deferred.await(hold)), Effect.as(7)) : Effect.succeed(7)
        )),
        Layer.provideMerge(Durable.layerStore(store))
      )
    }
  }
  const one = layer("v1", true)
  const running = Effect.runFork(one.W.execute({ id: "c" }).pipe(Effect.provide(one.layer)))
  await Effect.runPromise(Deferred.await(entered))
  const id = await Effect.runPromise(one.W.executionId({ id: "c" }))
  const fence = Option.getOrThrow(await Effect.runPromise(store.get(id))).fence
  const two = layer("v2", false)
  expect(failure(await Effect.runPromiseExit(two.W.execute({ id: "c" }).pipe(Effect.provide(two.layer))))).toContain("plan_changed")
  expect(Option.getOrThrow(await Effect.runPromise(store.get(id))).fence).toBe(fence)
  Effect.runSync(Deferred.succeed(hold, void 0))
  expect(await Effect.runPromise(Fiber.join(running))).toBe(7)
})

test("an engine that lost a run to another, which finished it, joins the stored result", async () => {
  const store = Durable.makeMemoryStore()
  const Slow = Durable.task("race#Slow", { payload: {}, success: Schema.Number })
  const W = Durable.workflow("race#Lost", { payload: { id: Schema.String }, success: Schema.Number })
  const hold = Deferred.makeUnsafe<void>()
  const entered = Deferred.makeUnsafe<void>()
  const engine = (blocking: boolean) =>
    W.toLayer(() => Slow({})).pipe(
      Layer.provide(Slow.toLayer(() =>
        blocking ? Deferred.succeed(entered, void 0).pipe(Effect.andThen(Deferred.await(hold)), Effect.as(1)) : Effect.succeed(2)
      )),
      Layer.provideMerge(Durable.layerStore(store))
    )
  const out = await Effect.runPromise(Effect.gen(function*() {
    const stale = yield* Effect.forkChild(Effect.exit(W.execute({ id: "d" })))
    yield* Deferred.await(entered)
    // Another engine takes the run over and finishes it.
    const other = yield* Effect.provide(W.execute({ id: "d" }), engine(false))
    yield* Deferred.succeed(hold, void 0)
    const lost = yield* Fiber.join(stale)
    // This engine, which lost the run, executes it again.
    const joined = yield* W.execute({ id: "d" })
    return { other, lost: failure(lost), joined }
  }).pipe(Effect.provide(engine(true))))
  expect(out.other).toBe(2)
  expect(out.lost).toContain("FenceLost")
  expect(out.joined).toBe(2)
})

test("a workflow result or a deferred holding a Redacted value is refused before it is journaled", async () => {
  const store = Durable.makeMemoryStore()
  const Secretive = Durable.workflow("race#Secretive", {
    payload: { id: Schema.String },
    success: Schema.Struct({ token: Schema.Redacted(Schema.String) })
  })
  const Signal = DurableDeferred.make("signal", { success: Schema.Redacted(Schema.String) })
  const Waits = Durable.workflow("race#Waits", { payload: { id: Schema.String } })
  const layer = Layer.mergeAll(
    Secretive.toLayer(() => Effect.succeed({ token: Redacted.make("hunter2") })),
    Waits.toLayer(() => Effect.asVoid(DurableDeferred.await(Signal)))
  ).pipe(Layer.provideMerge(Durable.layerStore(store)))
  const out = await Effect.runPromise(Effect.gen(function*() {
    const result = yield* Effect.exit(Secretive.execute({ id: "e" }))
    const id = yield* Waits.executionId({ id: "f" })
    yield* Waits.execute({ id: "f" }, { discard: true })
    const token = DurableDeferred.tokenFromExecutionId(Signal, { workflow: Waits, executionId: id })
    const signal = yield* Effect.exit(DurableDeferred.succeed(Signal, { token, value: Redacted.make("hunter2") }))
    return { result: failure(result), signal: failure(signal) }
  }).pipe(Effect.provide(layer)))
  expect(out.result).toContain("The result of workflow race#Secretive holds a Redacted value")
  expect(out.signal).toContain("The result of deferred signal holds a Redacted value")
  const journal = JSON.stringify(await Effect.runPromise(Effect.forEach(
    ["race#Secretive", "race#Waits"],
    () => store.list({})
  )))
  const entries = await Effect.runPromise(Effect.forEach(await Effect.runPromise(store.list({})), (row) => store.entries(row.run)))
  expect(journal + JSON.stringify(entries)).not.toContain("hunter2")
})

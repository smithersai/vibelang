import { expect, test } from "bun:test"
import { strict as assert } from "node:assert"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Stream } from "effect"
import { Durable } from "vibelang-runtime/experimental"

// Three steps; the last is irreversible unless a test asks otherwise.
const make = (tag: string, shipTier: Durable.Tier = "irreversible") => {
  const effects: Array<string> = []
  const Reserve = Durable.task(`${tag}#Reserve`, { payload: { id: Schema.String }, success: Schema.Number })
  const Charge = Durable.task(`${tag}#Charge`, { payload: { id: Schema.String }, success: Schema.String })
  const Ship = Durable.task(`${tag}#Ship`, { payload: { id: Schema.String }, tier: shipTier })
  const Order = Durable.workflow(`${tag}#Order`, { payload: { id: Schema.String }, success: Schema.String })
  const tasks = (hold?: Deferred.Deferred<void>, entered?: Deferred.Deferred<void>) =>
    Layer.mergeAll(
      Reserve.toLayer(({ id }) => Effect.sync(() => (effects.push(`reserve:${id}`), 7))),
      Charge.toLayer(({ id }) =>
        Effect.gen(function*() {
          if (entered) yield* Deferred.succeed(entered, void 0)
          if (hold) yield* Deferred.await(hold)
          effects.push(`charge:${id}`)
          return `receipt:${id}`
        })
      ),
      Ship.toLayer(({ id }) => Effect.sync(() => void effects.push(`ship:${id}`)))
    )
  const body = ({ id }: { readonly id: string }) =>
    Effect.gen(function*() {
      const amount = yield* Reserve({ id })
      const receipt = yield* Charge({ id })
      yield* Ship({ id })
      return `${receipt}:${amount}`
    })
  const layer = (store: Durable.Store, hold?: Deferred.Deferred<void>, entered?: Deferred.Deferred<void>) =>
    Order.toLayer(body).pipe(Layer.provide(tasks(hold, entered)), Layer.provideMerge(Durable.layerStore(store)))
  return { effects, Order, layer }
}

const read = <A, E>(store: Durable.Store, effect: Effect.Effect<A, E, Durable.Durable>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Durable.layerStore(store))))
const readExit = <A, E>(store: Durable.Store, effect: Effect.Effect<A, E, Durable.Durable>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(Durable.layerStore(store))))
const codeOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as Durable.TimeTravelError).code : undefined
const seqOf = async (store: Durable.Store, run: string, eventType: string, step: string) => {
  const entries = Array.from(await read(store, Stream.runCollect(Durable.history(run))))
  return entries.find((entry) => entry.eventType === eventType && (entry.payload as { step?: string }).step === step)!.seq
}

// The std-durable VIP's second example, as TypeScript.
const forkAt = (run: string, seq: number) =>
  Effect.gen(function*() {
    const events = yield* Stream.runCollect(Stream.map(Durable.history(run), (entry) => entry.eventType))
    const copy = yield* Durable.fork({ run, seq })
    return { events, copy }
  })

test("replay folds the journal up to a position, running nothing", async () => {
  const { effects, Order, layer } = make("tt1")
  const store = Durable.makeMemoryStore()
  await Effect.runPromise(Order.execute({ id: "a" }).pipe(Effect.provide(layer(store))))
  const run = await Effect.runPromise(Order.executionId({ id: "a" }))
  const before = effects.length
  const seq = await seqOf(store, run, "StepCompleted", "tt1#Charge/1")
  const seen = await read(store, Durable.replay({ run, seq }, { initial: [] as Array<string>, reduce: (acc, entry) => [...acc, entry.eventType] }))
  expect(seen).toEqual(["RunStarted", "StepStarted", "StepCompleted", "StepStarted", "StepCompleted"])
  expect(effects.length).toBe(before)
  expect(codeOf(await readExit(store, Durable.replay({ run, seq: 99 }, { initial: 0, reduce: (n) => n + 1 })))).toBe("invalid")
  expect(codeOf(await readExit(store, Durable.replay({ run: "nope", seq: 1 }, { initial: 0, reduce: (n) => n + 1 })))).toBe("not_found")
})

test("a fork reuses every step before its position and runs the rest; the original is unchanged", async () => {
  const { effects, Order, layer } = make("tt2")
  const store = Durable.makeMemoryStore()
  expect(await Effect.runPromise(Order.execute({ id: "b" }).pipe(Effect.provide(layer(store))))).toBe("receipt:b:7")
  const run = await Effect.runPromise(Order.executionId({ id: "b" }))
  const seq = await seqOf(store, run, "StepStarted", "tt2#Charge/1")
  const original = Array.from(await read(store, Stream.runCollect(Durable.history(run))))
  const { events, copy } = await read(store, forkAt(run, seq))
  expect(Array.from(events)).toEqual(original.map((entry) => entry.eventType))
  expect(copy.run).not.toBe(run)
  effects.length = 0
  expect(await Effect.runPromise(Durable.run(Order, copy.run).result.pipe(Effect.provide(layer(store))))).toBe("receipt:b:7")
  expect(effects).toEqual(["charge:b", "ship:b"])
  const forked = Array.from(await read(store, Stream.runCollect(Durable.history(copy.run))))
  expect(forked.slice(0, seq - 1).map((entry) => entry.eventType)).toEqual(original.slice(0, seq - 1).map((entry) => entry.eventType))
  expect(forked[seq - 1]!.eventType).toBe("RunForked")
  expect(Array.from(await read(store, Stream.runCollect(Durable.history(run)))).length).toBe(original.length)
})

test("a rewind truncates the run, and the next execution runs the removed steps again", async () => {
  const { effects, Order, layer } = make("tt3", "sealed")
  const store = Durable.makeMemoryStore()
  await Effect.runPromise(Order.execute({ id: "c" }).pipe(Effect.provide(layer(store))))
  const run = await Effect.runPromise(Order.executionId({ id: "c" }))
  const seq = await seqOf(store, run, "StepStarted", "tt3#Ship/1")
  await read(store, Durable.rewind({ run, seq }))
  const row = await read(store, Stream.runCollect(Durable.runs({ status: "suspended" })))
  expect(Array.from(row).map((r) => r.run)).toEqual([run])
  effects.length = 0
  expect(await Effect.runPromise(Order.execute({ id: "c" }).pipe(Effect.provide(layer(store))))).toBe("receipt:c:7")
  expect(effects).toEqual(["ship:c"])
  const kinds = Array.from(await read(store, Stream.runCollect(Durable.history(run)))).map((entry) => entry.eventType)
  expect(kinds.slice(seq - 1)).toEqual(["RunRewound", "StepStarted", "StepCompleted", "RunCompleted"])
})

test("a rewind refuses to cross an irreversible step, and refuses a bad position", async () => {
  const { Order, layer } = make("tt4")
  const store = Durable.makeMemoryStore()
  await Effect.runPromise(Order.execute({ id: "d" }).pipe(Effect.provide(layer(store))))
  const run = await Effect.runPromise(Order.executionId({ id: "d" }))
  const seq = await seqOf(store, run, "StepStarted", "tt4#Charge/1")
  expect(codeOf(await readExit(store, Durable.rewind({ run, seq })))).toBe("irreversible")
  expect(codeOf(await readExit(store, Durable.rewind({ run, seq: 1 })))).toBe("invalid")
  expect(codeOf(await readExit(store, Durable.rewind({ run: "nope", seq: 2 })))).toBe("not_found")
  expect(codeOf(await readExit(store, Durable.fork({ run: "nope", seq: 2 })))).toBe("not_found")
  const compensable = make("tt4c", "compensable")
  await Effect.runPromise(compensable.Order.execute({ id: "d" }).pipe(Effect.provide(compensable.layer(store))))
  const other = await Effect.runPromise(compensable.Order.executionId({ id: "d" }))
  expect(codeOf(await readExit(store, Durable.rewind({ run: other, seq: 2 })))).toBe("compensation_failed")
})

test("a rewind is busy while this engine runs the run, and fences out another engine that does", async () => {
  const { Order, layer } = make("tt5", "sealed")
  const store = Durable.makeMemoryStore()
  const hold = Deferred.makeUnsafe<void>()
  const entered = Deferred.makeUnsafe<void>()
  const run = await Effect.runPromise(Order.executionId({ id: "e" }))
  // In one engine: busy.
  const busy = await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Order.execute({ id: "e" }))
    yield* Deferred.await(entered)
    const exit = yield* Effect.exit(Durable.rewind({ run, seq: 2 }))
    yield* Fiber.interrupt(fiber)
    return exit
  }).pipe(Effect.provide(layer(store, hold, entered))))
  expect(codeOf(busy)).toBe("busy")
  // From another engine: the rewind takes the run, and the first engine's next write is refused.
  const entered2 = Deferred.makeUnsafe<void>()
  const hold2 = Deferred.makeUnsafe<void>()
  const stale = Effect.runFork(Order.execute({ id: "e" }).pipe(Effect.provide(layer(store, hold2, entered2))))
  await Effect.runPromise(Deferred.await(entered2))
  await read(store, Durable.rewind({ run, seq: 2 }))
  Effect.runSync(Deferred.succeed(hold2, void 0))
  const exit = await Effect.runPromise(Fiber.await(stale))
  assert.ok(Exit.isFailure(exit))
  expect(Cause.pretty(exit.cause)).toContain("FenceLost")
})

test("start always begins a new run; spawn joins the run equal input names", async () => {
  const { effects, Order, layer } = make("tt6", "sealed")
  const store = Durable.makeMemoryStore()
  const program = Effect.gen(function*() {
    const a = yield* Durable.start(Order, { id: "f" })
    const b = yield* Durable.start(Order, { id: "f" })
    const results = [yield* a.result, yield* b.result]
    const joined = yield* Durable.spawn(Order, { id: "g" })
    const again = yield* Durable.spawn(Order, { id: "g" })
    const fromId = Durable.run(Order, joined.id)
    return { ids: [a.id, b.id, joined.id, again.id], results, g: [yield* joined.result, yield* fromId.result], poll: yield* fromId.poll }
  })
  const out = await Effect.runPromise(program.pipe(Effect.provide(layer(store))))
  expect(out.ids[0]).not.toBe(out.ids[1])
  expect(out.ids[2]).toBe(out.ids[3])
  expect(out.results).toEqual(["receipt:f:7", "receipt:f:7"])
  expect(out.g).toEqual(["receipt:g:7", "receipt:g:7"])
  expect(out.poll).toEqual(Option.some(Exit.succeed("receipt:g:7")))
  expect(effects.filter((effect) => effect === "ship:f").length).toBe(2)
  expect(effects.filter((effect) => effect === "ship:g").length).toBe(1)
})

test("runs filters by status and workflow, and sweep deletes only old finished runs", async () => {
  const one = make("tt7a", "sealed")
  const two = make("tt7b", "sealed")
  const store = Durable.makeMemoryStore()
  await Effect.runPromise(one.Order.execute({ id: "h" }).pipe(Effect.provide(one.layer(store))))
  await Effect.runPromise(two.Order.execute({ id: "h" }).pipe(Effect.provide(two.layer(store))))
  const all = Array.from(await read(store, Stream.runCollect(Durable.runs())))
  expect(all.map((row) => row.status)).toEqual(["succeeded", "succeeded"])
  expect(Array.from(await read(store, Stream.runCollect(Durable.runs({ workflow: "tt7a#Order" })))).length).toBe(1)
  expect(await read(store, Durable.sweep({ olderThan: "1 hour" }))).toBe(0)
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(await read(store, Durable.sweep({ olderThan: 0 }))).toBe(2)
  expect(Array.from(await read(store, Stream.runCollect(Durable.runs()))).length).toBe(0)
})

import { expect, test } from "bun:test"
import { strict as assert } from "node:assert"
import fc from "fast-check"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { Workflow } from "effect/workflow"
import { Durable } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// The outside world a step changes. Every effect is counted, and the store
// and this list are all that survive a crash.
interface OutsideShape {
  readonly perform: (name: string) => Effect.Effect<void>
}
const Outside = Context.Service<OutsideShape>("test/Durable/Outside")

const realOutside = (effects: Array<string>) =>
  Layer.succeed(Outside, { perform: (name: string) => Effect.sync(() => void effects.push(name)) })

type Phase = "before" | "after"

// The injected fault: the real service, except that at `name` the process
// dies, before the effect or after it and before anything is recorded.
const faultyOutside = (effects: Array<string>, crash: { readonly name: string; readonly phase: Phase }, died: Deferred.Deferred<void>) =>
  Layer.succeed(Outside, {
    perform: (name: string) => {
      if (name !== crash.name) return Effect.sync(() => void effects.push(name))
      const effect = crash.phase === "after" ? Effect.sync(() => void effects.push(name)) : Effect.void
      return effect.pipe(Effect.andThen(Deferred.succeed(died, void 0)), Effect.andThen(Effect.never))
    }
  })

const Reserve = Durable.task("test#Reserve", { payload: { id: Schema.String }, success: Schema.Number })
const Charge = Durable.task("test#Charge", { payload: { id: Schema.String, amount: Schema.Number }, success: Schema.String })
const Ship = Durable.task("test#Ship", { payload: { id: Schema.String }, tier: "irreversible" })

const Order = Workflow.make("test#Order", {
  payload: { id: Schema.String },
  success: Schema.String,
  idempotencyKey: ({ id }) => id
})

const orderTasks = Layer.mergeAll(
  Reserve.toLayer(({ id }) => Effect.flatMap(Effect.service(Outside), (outside) => Effect.as(outside.perform(`reserve:${id}`), 42))),
  Charge.toLayer(({ id, amount }) =>
    Effect.flatMap(Effect.service(Outside), (outside) => Effect.as(outside.perform(`charge:${id}`), `receipt-${amount}`))
  ),
  Ship.toLayer(({ id }) => Effect.flatMap(Effect.service(Outside), (outside) => outside.perform(`ship:${id}`)))
)

const orderLayer = (store: Durable.Store, outside: Layer.Layer<Context.Service.Identifier<typeof Outside>>) =>
  Order.toLayer(({ id }) =>
    Effect.gen(function*() {
      const amount = yield* Reserve({ id })
      const receipt = yield* Charge({ id, amount })
      yield* Ship({ id })
      return `${id}:${receipt}`
    })
  ).pipe(
    Layer.provide(orderTasks),
    Layer.provideMerge(Durable.layerStore(store)),
    Layer.provide(outside)
  )

// One process: runs `program` until it finishes or the faulty service kills it.
const process = <A, E>(program: Effect.Effect<A, E>, died: Deferred.Deferred<void>) =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(program)
    const ended = yield* Effect.raceFirst(
      Effect.as(Deferred.await(died), "died" as const),
      Effect.as(Fiber.await(fiber), "finished" as const)
    )
    if (ended === "died") yield* Fiber.interrupt(fiber)
    return ended
  })

const events = (store: Durable.Store, run: string) =>
  Effect.runPromise(Stream.runCollect(Durable.history(run)).pipe(Effect.provide(Durable.layerStore(store))))

test("a crash after a step's effect resumes the run: finished steps are served, the unfinished one runs again", async () => {
  const store = Durable.makeMemoryStore()
  const effects: Array<string> = []
  const died = Deferred.makeUnsafe<void>()
  const run = await Effect.runPromise(Order.executionId({ id: "o1" }))

  const first = await Effect.runPromise(process(
    Order.execute({ id: "o1" }).pipe(Effect.provide(orderLayer(store, faultyOutside(effects, { name: "charge:o1", phase: "after" }, died)))),
    died
  ))
  expect(first).toBe("died")
  expect(effects).toEqual(["reserve:o1", "charge:o1"])

  const result = await Effect.runPromise(Order.execute({ id: "o1" }).pipe(Effect.provide(orderLayer(store, realOutside(effects)))))
  expect(result).toBe("o1:receipt-42")
  // Reserve finished before the crash and is not repeated; Charge is, because
  // its result was never recorded: at-least-once.
  expect(effects).toEqual(["reserve:o1", "charge:o1", "charge:o1", "ship:o1"])

  const journal = Array.from(await events(store, run))
  expect(journal.map((entry) => entry.seq)).toEqual(journal.map((_, index) => index + 1))
  expect(journal.map((entry) => [entry.eventType, (entry.payload as { step?: string }).step ?? null])).toEqual([
    ["RunStarted", null],
    ["StepStarted", "test#Reserve/1"],
    ["StepCompleted", "test#Reserve/1"],
    ["StepStarted", "test#Charge/1"],
    ["StepStarted", "test#Charge/1"],
    ["StepCompleted", "test#Charge/1"],
    ["StepStarted", "test#Ship/1"],
    ["StepCompleted", "test#Ship/1"],
    ["RunCompleted", null]
  ])
  expect((journal[6]!.payload as { tier: string }).tier).toBe("irreversible")
})

test("a crash before a step's effect runs the effect once", async () => {
  const store = Durable.makeMemoryStore()
  const effects: Array<string> = []
  const died = Deferred.makeUnsafe<void>()
  await Effect.runPromise(process(
    Order.execute({ id: "o2" }).pipe(Effect.provide(orderLayer(store, faultyOutside(effects, { name: "ship:o2", phase: "before" }, died)))),
    died
  ))
  expect(effects).toEqual(["reserve:o2", "charge:o2"])
  expect(await Effect.runPromise(Order.execute({ id: "o2" }).pipe(Effect.provide(orderLayer(store, realOutside(effects)))))).toBe(
    "o2:receipt-42"
  )
  expect(effects).toEqual(["reserve:o2", "charge:o2", "ship:o2"])
})

test("equal input joins the finished run: nothing runs and nothing is journaled", async () => {
  const store = Durable.makeMemoryStore()
  const effects: Array<string> = []
  const run = await Effect.runPromise(Order.executionId({ id: "o3" }))
  const once = await Effect.runPromise(Order.execute({ id: "o3" }).pipe(Effect.provide(orderLayer(store, realOutside(effects)))))
  const length = (await events(store, run)).length
  const again = await Effect.runPromise(Order.execute({ id: "o3" }).pipe(Effect.provide(orderLayer(store, realOutside(effects)))))
  expect(again).toBe(once)
  expect(effects).toEqual(["reserve:o3", "charge:o3", "ship:o3"])
  expect((await events(store, run)).length).toBe(length)
})

test("a typed step failure is recorded and replayed, not retried", async () => {
  const store = Durable.makeMemoryStore()
  let calls = 0
  const Flaky = Durable.task("test#Flaky", { payload: {}, error: Schema.String })
  const W = Workflow.make("test#FlakyFlow", { payload: {}, error: Schema.String, idempotencyKey: () => "one" })
  const layer = () =>
    W.toLayer(() => Flaky({})).pipe(
      Layer.provide(Flaky.toLayer(() => Effect.suspend(() => (calls++, Effect.fail("no stock"))))),
      Layer.provideMerge(Durable.layerStore(store))
    )
  const first = await Effect.runPromiseExit(W.execute({}).pipe(Effect.provide(layer())))
  const second = await Effect.runPromiseExit(W.execute({}).pipe(Effect.provide(layer())))
  const failure = (exit: Exit.Exit<unknown, unknown>) => Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit
  expect(failure(first)).toBe("no stock")
  expect(failure(second)).toBe("no stock")
  expect(calls).toBe(1)
})

test("a retry policy retries a typed failure, and each attempt is its own journaled step", async () => {
  const store = Durable.makeMemoryStore()
  let calls = 0
  const Flaky = Durable.task("test#Retried", {
    payload: {},
    success: Schema.Number,
    error: Schema.String,
    retryPolicy: { initialMs: 1, factor: 2, maxMs: 4, maxAttempts: 3 }
  })
  const W = Workflow.make("test#RetriedFlow", { payload: {}, success: Schema.Number, error: Schema.String, idempotencyKey: () => "one" })
  const layer = W.toLayer(() => Flaky({})).pipe(
    Layer.provide(Flaky.toLayer(() => Effect.suspend(() => ++calls < 3 ? Effect.fail(`attempt ${calls}`) : Effect.succeed(calls)))),
    Layer.provideMerge(Durable.layerStore(store))
  )
  expect(await Effect.runPromise(W.execute({}).pipe(Effect.provide(layer)))).toBe(3)
  const run = await Effect.runPromise(W.executionId({}))
  const completed = Array.from(await events(store, run)).filter((entry) => entry.eventType === "StepCompleted")
  expect(completed.map((entry) => (entry.payload as { attempt: number }).attempt)).toEqual([1, 2, 3])
})

test("one owner per run: an engine that lost the run dies with FenceLost on its next write", async () => {
  const store = Durable.makeMemoryStore()
  const effects: Array<string> = []
  const latch = Deferred.makeUnsafe<void>()
  const entered = Deferred.makeUnsafe<void>()
  const stalled = Layer.succeed(Outside, {
    perform: (name: string) =>
      name === "charge:o4"
        ? Deferred.succeed(entered, void 0).pipe(Effect.andThen(Deferred.await(latch)), Effect.andThen(Effect.sync(() => void effects.push(name))))
        : Effect.sync(() => void effects.push(name))
  })
  const run = await Effect.runPromise(Order.executionId({ id: "o4" }))
  const stale = Effect.runFork(Order.execute({ id: "o4" }).pipe(Effect.provide(orderLayer(store, stalled))))
  await Effect.runPromise(Deferred.await(entered))
  // A second engine takes the run over and finishes it.
  expect(await Effect.runPromise(Order.execute({ id: "o4" }).pipe(Effect.provide(orderLayer(store, realOutside(effects)))))).toBe(
    "o4:receipt-42"
  )
  Effect.runSync(Deferred.succeed(latch, void 0))
  const staleExit = await Effect.runPromise(Fiber.await(stale))
  assert.ok(Exit.isFailure(staleExit))
  expect(Cause.pretty(staleExit.cause)).toContain("FenceLost")
  const completed = Array.from(await events(store, run)).filter((entry) =>
    entry.eventType === "StepCompleted" && (entry.payload as { step: string }).step === "test#Charge/1"
  )
  expect(completed.length).toBe(1)
})

// At-least-once, exactly: after any sequence of crashes, each step's effect
// ran once plus once for every crash that hit it after the effect and before
// its record. A step that finished never runs again, and every step runs.
type Crash = { readonly step: number; readonly phase: Phase }
type Input = { readonly steps: number; readonly crashes: ReadonlyArray<Crash> }

const Step = Durable.task("test#Step", { payload: { i: Schema.Number }, success: Schema.Number })
const Steps = Workflow.make("test#Steps", { payload: { n: Schema.Number }, success: Schema.Number, idempotencyKey: ({ n }) => String(n) })

const stepsLayer = (store: Durable.Store, outside: Layer.Layer<Context.Service.Identifier<typeof Outside>>) =>
  Steps.toLayer(({ n }) =>
    Effect.gen(function*() {
      let total = 0
      for (let i = 0; i < n; i++) total += yield* Step({ i })
      return total
    })
  ).pipe(
    Layer.provide(Step.toLayer(({ i }) => Effect.flatMap(Effect.service(Outside), (outside) => Effect.as(outside.perform(`step:${i}`), i * i)))),
    Layer.provideMerge(Durable.layerStore(store)),
    Layer.provide(outside)
  )

const atLeastOnce = async (input: Input) => {
  const store = Durable.makeMemoryStore()
  const effects: Array<string> = []
  const fired: Array<Crash> = []
  for (const crash of input.crashes) {
    const died = Deferred.makeUnsafe<void>()
    const ended = await Effect.runPromise(process(
      Effect.exit(Steps.execute({ n: input.steps })).pipe(
        Effect.provide(stepsLayer(store, faultyOutside(effects, { name: `step:${crash.step}`, phase: crash.phase }, died)))
      ),
      died
    ))
    if (ended === "died") fired.push(crash)
  }
  const total = await Effect.runPromise(Steps.execute({ n: input.steps }).pipe(Effect.provide(stepsLayer(store, realOutside(effects)))))
  let expected = 0
  for (let i = 0; i < input.steps; i++) {
    expected += i * i
    const ran = effects.filter((effect) => effect === `step:${i}`).length
    const repeats = fired.filter((crash) => crash.step === i && crash.phase === "after").length
    assert.equal(ran, 1 + repeats, `step ${i} ran ${ran} times after crashes ${JSON.stringify(fired)}`)
  }
  assert.equal(total, expected)
  const run = await Effect.runPromise(Steps.executionId({ n: input.steps }))
  const completed = Array.from(await events(store, run)).filter((entry) => entry.eventType === "StepCompleted")
  assert.equal(completed.length, input.steps)
}

test("at-least-once: crashes at any step and phase never skip a step or repeat a finished one", async () => {
  await checkProperty(fc, {
    name: "durable-at-least-once",
    rule: "std-durable: a finished step never runs twice in one run; a step that did not finish can run again",
    command: "bun test tests/experimental-durable.test.ts",
    arbitrary: fc.integer({ min: 1, max: 6 }).chain((steps) =>
      fc.record({
        steps: fc.constant(steps),
        crashes: fc.array(
          fc.record({ step: fc.integer({ min: 0, max: steps - 1 }), phase: fc.constantFrom<Phase>("before", "after") }),
          { maxLength: 4 }
        )
      })
    ),
    numRuns: 60,
    check: atLeastOnce
  })
}, 60000)

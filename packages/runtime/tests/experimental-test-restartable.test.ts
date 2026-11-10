import { expect, test } from "bun:test"
import fc from "fast-check"
import { Context, Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { Durable, Test } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

// The outside world a step changes, and a gate a test closes to stop a
// step part way: at a gated step the handler signals `reached` and waits
// forever, as a process does when it is killed mid-step.
interface WorldShape {
  readonly perform: (name: string) => Effect.Effect<void>
}
const World = Context.Service<WorldShape>("test/Test/World")

const Step = Durable.task("test#Step", { payload: { n: Schema.Number }, success: Schema.Number })
const Steps = Durable.workflow("test#Steps", { payload: { count: Schema.Number }, success: Schema.Number })

const world = (effects: Array<string>, gate: { blockAt?: string; reached?: Deferred.Deferred<void> }) =>
  Layer.succeed(World, {
    perform: (name: string) => {
      if (gate.blockAt !== name) return Effect.sync(() => void effects.push(name))
      const reached = gate.reached!
      gate.blockAt = undefined
      return Effect.andThen(Deferred.succeed(reached, void 0), Effect.never)
    }
  })

const program = (effects: Array<string>, gate: { blockAt?: string; reached?: Deferred.Deferred<void> }, engine: Layer.Layer<any>) =>
  Steps.toLayer(({ count }) =>
    Effect.gen(function*() {
      let total = 0
      for (let n = 1; n <= count; n++) total += yield* Step({ n })
      return total
    })
  ).pipe(
    Layer.provide(Step.toLayer(({ n }) => Effect.flatMap(Effect.service(World), (w) => Effect.as(w.perform(`step:${n}`), n)))),
    Layer.provide(world(effects, gate)),
    Layer.provideMerge(engine)
  )

const history = (run: string) => Stream.runCollect(Durable.history(run)).pipe(Effect.map((entries) => Array.from(entries, (e) => e.eventType)))

test("Test.crash kills the engine mid-step; the next execution serves finished steps and runs the unfinished one again", async () => {
  const effects: Array<string> = []
  const reached = Deferred.makeUnsafe<void>()
  const gate = { blockAt: "step:2", reached }
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const first = yield* Effect.forkChild(Steps.execute({ count: 3 }))
    yield* Deferred.await(reached)
    yield* Test.crash
    const total = yield* Steps.execute({ count: 3 })
    const run = yield* Steps.executionId({ count: 3 })
    yield* Fiber.interrupt(first)
    return { total, events: yield* history(run) }
  })).pipe(Effect.provide(program(effects, gate, Test.restartable))))
  expect(result.total).toBe(6)
  // step:1 finished before the crash and is served; step:2 never finished and
  // runs again on the fresh engine.
  expect(effects).toEqual(["step:1", "step:2", "step:3"])
  expect(result.events).toEqual([
    "RunStarted",
    "StepStarted",
    "StepCompleted",
    "StepStarted",
    "StepStarted",
    "StepCompleted",
    "StepStarted",
    "StepCompleted",
    "RunCompleted"
  ])
})

test("Test.crash with no run in flight leaves finished runs answerable from the journal", async () => {
  const effects: Array<string> = []
  const result = await Effect.runPromise(Effect.gen(function*() {
    const first = yield* Steps.execute({ count: 2 })
    yield* Test.crash
    yield* Test.crash
    const again = yield* Steps.execute({ count: 2 })
    return [first, again]
  }).pipe(Effect.provide(program(effects, {}, Test.restartable))))
  expect(result).toEqual([3, 3])
  expect(effects).toEqual(["step:1", "step:2"])
})

test("Test.durable runs a workflow on a memory engine and journals it", async () => {
  const effects: Array<string> = []
  const result = await Effect.runPromise(Effect.gen(function*() {
    const total = yield* Steps.execute({ count: 2 })
    return { total, events: yield* history(yield* Steps.executionId({ count: 2 })) }
  }).pipe(Effect.provide(program(effects, {}, Test.durable))))
  expect(result.total).toBe(3)
  expect(result.events).toEqual(["RunStarted", "StepStarted", "StepCompleted", "StepStarted", "StepCompleted", "RunCompleted"])
})

// VIP-71 rule 8: only a restartable engine proves recovery. Whatever step a
// run is killed in, and however many times, the run finishes with the same
// result, every step's effect happens, and a step finished before a crash is
// never repeated.
test("property: crashes at any steps never change the result or repeat a finished step", async () => {
  await checkProperty(fc, {
    name: "test-restartable-recovery",
    rule: "VIP-71: Test.restartable with Test.crash kills and resumes a run between steps",
    command: "bun test tests/experimental-test-restartable.test.ts",
    arbitrary: fc.integer({ min: 1, max: 5 }).chain((count) =>
      fc.record({ count: fc.constant(count), crashes: fc.uniqueArray(fc.integer({ min: 1, max: count }), { maxLength: count }) })
    ),
    numRuns: 40,
    check: async ({ count, crashes }: { readonly count: number; readonly crashes: ReadonlyArray<number> }) => {
      const effects: Array<string> = []
      const ordered = [...crashes].sort((a, b) => a - b)
      const gate: { blockAt?: string; reached?: Deferred.Deferred<void> } = {}
      const total = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const stragglers: Array<Fiber.Fiber<unknown, unknown>> = []
        for (const step of ordered) {
          gate.reached = Deferred.makeUnsafe<void>()
          gate.blockAt = `step:${step}`
          stragglers.push(yield* Effect.forkChild(Steps.execute({ count })))
          yield* Deferred.await(gate.reached)
          yield* Test.crash
        }
        const total = yield* Steps.execute({ count })
        for (const fiber of stragglers) yield* Fiber.interrupt(fiber)
        return total
      })).pipe(Effect.provide(program(effects, gate, Test.restartable))))
      expect(total).toBe((count * (count + 1)) / 2)
      // Each step ran once to completion; a crashed step started but never
      // recorded its effect, because the gate held it before the effect.
      expect(effects).toEqual(Array.from({ length: count }, (_, i) => `step:${i + 1}`))
    }
  })
}, 60000)

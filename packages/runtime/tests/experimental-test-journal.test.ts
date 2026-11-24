import { expect, test } from "bun:test"
import fc from "fast-check"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { Durable, Test } from "vibelang-runtime/experimental"
import { checkProperty } from "../../../scripts/testing/property.mjs"

interface WorldShape {
  readonly perform: (name: string) => Effect.Effect<void, string>
}
const World = Context.Service<WorldShape>("test/Journal/World")

const Step = Durable.task("journal#Step", { payload: { n: Schema.Number }, success: Schema.Number })
const Flaky = Durable.task("journal#Flaky", {
  payload: { n: Schema.Number },
  success: Schema.Number,
  error: Schema.String,
  retryPolicy: { initialMs: 1, factor: 1, maxMs: 1, maxAttempts: 5 }
})
const Steps = Durable.workflow("journal#Steps", { payload: { count: Schema.Number }, success: Schema.Number, error: Schema.String })

type Gate = { blockAt?: string; reached?: Deferred.Deferred<void>; failures: number }

// The injected world: it blocks a gated step forever, as a killed process
// does, and fails the flaky step `failures` times before it succeeds.
const world = (gate: Gate) =>
  Layer.succeed(World, {
    perform: (name: string) => {
      if (gate.blockAt === name) {
        gate.blockAt = undefined
        return Effect.andThen(Deferred.succeed(gate.reached!, void 0), Effect.never)
      }
      if (name === "flaky" && gate.failures > 0) {
        gate.failures -= 1
        return Effect.fail("transient")
      }
      return Effect.void
    }
  })

const program = (gate: Gate) =>
  Steps.toLayer(({ count }) =>
    Effect.gen(function*() {
      let total = 0
      for (let n = 1; n <= count; n++) total += yield* Step({ n })
      total += yield* Flaky({ n: 0 })
      return total
    })
  ).pipe(
    Layer.provide(Step.toLayer(({ n }) => Effect.flatMap(Effect.service(World), (w) => Effect.as(Effect.orDie(w.perform(`step:${n}`)), n)))),
    Layer.provide(Flaky.toLayer(() => Effect.flatMap(Effect.service(World), (w) => Effect.as(w.perform("flaky"), 0)))),
    Layer.provide(world(gate)),
    Layer.provideMerge(Test.restartable)
  )

const runWith = <A, E>(gate: Gate, effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(program(gate))) as Effect.Effect<A, E>)

test("Test.journal reports the steps in order, their attempts and the run's status", async () => {
  const journal = await runWith({ failures: 2 }, Effect.gen(function*() {
    yield* Steps.execute({ count: 2 })
    return yield* Test.journal(yield* Steps.executionId({ count: 2 }))
  }))
  expect(journal.status).toBe("succeeded")
  expect(journal.steps.map((s) => [s.step, s.attempts, s.starts, s.outcome])).toEqual([
    ["journal#Step/1", 1, 1, "success"],
    ["journal#Step/2", 1, 1, "success"],
    ["journal#Flaky/1", 3, 3, "success"]
  ])
  await Effect.runPromise(Effect.all([
    journal.executed("journal#Step"),
    journal.executedInOrder(["journal#Step/1", "journal#Flaky"]),
    journal.attempts("journal#Flaky", 3),
    journal.terminal("succeeded")
  ]))
})

test("Test.journal assertions fail with JournalMismatch when the journal says otherwise", async () => {
  const journal = await runWith({ failures: 0 }, Effect.gen(function*() {
    yield* Steps.execute({ count: 2 })
    return yield* Test.journal(yield* Steps.executionId({ count: 2 }))
  }))
  const mismatch = async (effect: Effect.Effect<void, Test.JournalMismatch>) => {
    const exit = await Effect.runPromiseExit(effect)
    return Exit.isFailure(exit) ? (Cause.squash(exit.cause) as Test.JournalMismatch) : undefined
  }
  expect((await mismatch(journal.executedInOrder(["journal#Step/2", "journal#Step/1"])))?.actual).toEqual([
    "journal#Step/1",
    "journal#Step/2",
    "journal#Flaky/1"
  ])
  expect((await mismatch(journal.attempts("journal#Flaky", 2)))?.actual).toBe(1)
  expect(await mismatch(journal.executed("journal#Missing"))).toBeInstanceOf(Test.JournalMismatch)
  expect((await mismatch(journal.terminal("failed")))?.actual).toBe("succeeded")
})

test("Test.journal tells a restart after a crash from a retry: starts grow, attempts do not", async () => {
  const gate: Gate = { blockAt: "step:2", reached: Deferred.makeUnsafe<void>(), failures: 0 }
  const journal = await runWith(gate, Effect.gen(function*() {
    const first = yield* Effect.forkChild(Steps.execute({ count: 2 }))
    yield* Deferred.await(gate.reached!)
    const stopped = yield* Test.journal(yield* Steps.executionId({ count: 2 }))
    expect(stopped.status).toBe("running")
    expect(stopped.steps.map((s) => s.outcome)).toEqual(["success", undefined])
    yield* Test.crash
    yield* Steps.execute({ count: 2 })
    yield* Fiber.interrupt(first)
    return yield* Test.journal(yield* Steps.executionId({ count: 2 }))
  }))
  const step2 = journal.steps.find((s) => s.step === "journal#Step/2")!
  expect([step2.attempts, step2.starts, step2.outcome]).toEqual([1, 2, "success"])
})

test("Test.divergence finds nothing between equal journals and names the first differing entry otherwise", async () => {
  const result = await runWith({ failures: 1 }, Effect.gen(function*() {
    const id = yield* Steps.executionId({ count: 2 })
    yield* Steps.execute({ count: 2 })
    const again = yield* Durable.start(Steps, { count: 2 })
    yield* again.result
    const same = yield* Test.divergence(id, id)
    // The second run's flaky step succeeds at once: one attempt, not two.
    const retried = yield* Test.divergence(id, again.id)
    return { same, retried }
  }))
  expect(Option.isNone(result.same)).toBe(true)
  const found = Option.getOrThrow(result.retried)
  expect([found.seq, found.field]).toEqual([7, "payload"])
})

test("Test.divergence names field entry when one journal is shorter than the other", async () => {
  const result = await runWith({ failures: 0 }, Effect.gen(function*() {
    const id = yield* Steps.executionId({ count: 1 })
    yield* Steps.execute({ count: 1 })
    const entries = (yield* Test.journal(id)).entries.length
    const absent = yield* Steps.executionId({ count: 99 })
    return { entries, longer: yield* Test.divergence(id, absent), shorter: yield* Test.divergence(absent, id) }
  }))
  expect(result.entries).toBeGreaterThan(0)
  const longer = Option.getOrThrow(result.longer)
  expect([longer.seq, longer.field, longer.actual]).toEqual([1, "entry", undefined])
  expect((longer.expected as Durable.JournalEntry).eventType).toBe("RunStarted")
  const shorter = Option.getOrThrow(result.shorter)
  expect([shorter.seq, shorter.field, shorter.expected]).toEqual([1, "entry", undefined])
})

test("Test.journal reports a failed run and a step whose outcome is failure", async () => {
  // Flaky fails more often than its five attempts allow, so the run fails.
  const journal = await runWith({ failures: 10 }, Effect.gen(function*() {
    const exit = yield* Effect.exit(Steps.execute({ count: 1 }))
    expect(Exit.isFailure(exit)).toBe(true)
    return yield* Test.journal(yield* Steps.executionId({ count: 1 }))
  }))
  expect(journal.status).toBe("failed")
  expect(journal.steps.map((s) => [s.step, s.attempts, s.outcome])).toEqual([
    ["journal#Step/1", 1, "success"],
    ["journal#Flaky/1", 5, "failure"]
  ])
  await Effect.runPromise(journal.terminal("failed"))
  const missing = await Effect.runPromiseExit(journal.executed("journal#Flaky"))
  expect(Exit.isFailure(missing) && Cause.squash(missing.cause)).toBeInstanceOf(Test.JournalMismatch)
})

const Parks = Durable.workflow("journal#Parks", { payload: { id: Schema.String }, success: Schema.String })
const statusWorld = Parks.toLayer(({ id }) => Effect.as(Durable.sleep("1 hour"), id)).pipe(Layer.provideMerge(Test.restartable))

const runStatus = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(statusWorld)) as Effect.Effect<A, E>)

// Polls the journal of `run` until it reports `status`, as a parked run's
// status changes on the engine's fiber, not the caller's.
const awaitStatus = (run: string, status: Test.JournalStatus) =>
  Effect.gen(function*() {
    for (let i = 0; i < 400; i++) {
      const seen = yield* Test.journal(run)
      if (seen.status === status) return seen
      yield* Effect.sleep(5)
    }
    return yield* Test.journal(run)
  })

test("Test.journal reports a run parked on a durable timer as suspended, and an interrupted run as interrupted", async () => {
  const { parked, interrupted } = await runStatus(Effect.gen(function*() {
    const run = yield* Durable.start(Parks, { id: "a" })
    const parked = yield* awaitStatus(run.id, "suspended")
    // An interrupt from outside, through the workflow, ends the parked run.
    yield* Parks.interrupt(run.id)
    return { parked, interrupted: yield* awaitStatus(run.id, "interrupted") }
  }))
  expect(parked.status).toBe("suspended")
  expect(parked.entries.map((entry) => entry.eventType)).toContain("RunSuspended")
  await Effect.runPromise(parked.terminal("suspended"))
  expect(interrupted.status).toBe("interrupted")
  expect(interrupted.entries.at(-1)?.eventType).toBe("RunCompleted")
  await Effect.runPromise(interrupted.terminal("interrupted"))
})

// VIP-71: Test.divergence reports the FIRST attributable difference. A run
// crashed first at step c differs from a clean run of the same workflow
// exactly where the clean run completed step c and the crashed run started
// it again: entry 2c + 1, as an event type.
test("property: a crash at step c diverges from a clean run at entry 2c + 1", async () => {
  await checkProperty(fc, {
    name: "test-divergence-first-crash",
    rule: "VIP-71: Test.divergence(runA, runB) is the first attributable difference between two journals",
    command: "bun test tests/experimental-test-journal.test.ts",
    arbitrary: fc.integer({ min: 1, max: 5 }).chain((count) =>
      fc.record({ count: fc.constant(count), crash: fc.option(fc.integer({ min: 1, max: count }), { nil: undefined }) })
    ),
    numRuns: 40,
    check: async ({ count, crash }: { readonly count: number; readonly crash: number | undefined }) => {
      const gate: Gate = { failures: 0 }
      const found = await runWith(gate, Effect.gen(function*() {
        const clean = yield* Durable.start(Steps, { count })
        yield* clean.result
        if (crash !== undefined) {
          gate.blockAt = `step:${crash}`
          gate.reached = Deferred.makeUnsafe<void>()
        }
        // start runs the workflow on the engine at once; the crash kills it there.
        const crashed = yield* Durable.start(Steps, { count })
        if (crash !== undefined) {
          yield* Deferred.await(gate.reached!)
          yield* Test.crash
        }
        yield* crashed.result
        return yield* Test.divergence(clean.id, crashed.id)
      }))
      if (crash === undefined) {
        expect(Option.isNone(found)).toBe(true)
      } else {
        const divergence = Option.getOrThrow(found)
        expect([divergence.seq, divergence.field, divergence.expected, divergence.actual]).toEqual([
          2 * crash + 1,
          "eventType",
          "StepCompleted",
          "StepStarted"
        ])
      }
    }
  })
}, 60000)

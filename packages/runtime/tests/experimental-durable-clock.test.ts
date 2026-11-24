import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, Option, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { DurableClock } from "effect/workflow"
import { Durable } from "vibelang-runtime/experimental"
import { storeFactories } from "./fixtures/bun-sqlite-client.ts"

// A workflow that waits on a durable clock. inMemoryThreshold 0 sends every
// sleep through the engine's scheduleClock, as a sleep over a minute is.
const Reminder = Durable.workflow("clock#Reminder", { payload: { id: Schema.String }, success: Schema.String })
const layer = (store: Durable.Store) =>
  Reminder.toLayer(({ id }) =>
    Effect.as(DurableClock.sleep({ name: "wait", duration: "1500 millis", inMemoryThreshold: 0 }), `remind:${id}`)
  ).pipe(Layer.provideMerge(Durable.layerStore(store)))

// Time is Effect's TestClock, which the engine reads through Clock, so the
// remaining delay is asserted to the millisecond. Real time passes only to
// let fibers reach their next wait; no assertion depends on it.
const settle = TestClock.withLive(Effect.sleep("20 millis"))
const journal = (store: Durable.Store, run: string) => Effect.map(store.entries(run), (entries) => Array.from(entries))

for (const [name, open] of storeFactories) describe(`${name} store`, () => {
  test("a run killed while a durable clock runs wakes when the clock was due, not a full delay later", async () => {
    const { store, another } = await open()
    const second = await another()
    const out = await Effect.runPromise(Effect.gen(function*() {
      yield* TestClock.setTime(10_000)
      const run = yield* Reminder.executionId({ id: "a" })
      // The first engine starts the clock, 400 ms pass, then its process dies.
      yield* Effect.scoped(Effect.gen(function*() {
        const env = yield* Layer.build(layer(store))
        const first = yield* Effect.forkChild(Reminder.execute({ id: "a" }).pipe(Effect.provide(env)))
        while (!(yield* journal(store, run)).some((entry) => entry.eventType === "ClockScheduled")) yield* settle
        yield* TestClock.adjust(400)
        yield* settle
        yield* Fiber.interrupt(first)
      }))
      const scheduled = (yield* journal(store, run)).filter((entry) => entry.eventType === "ClockScheduled")
      const statusAtCrash = Option.getOrThrow(yield* store.get(run)).status
      // A second engine resumes the run at 10 400: 1100 ms of the clock remain.
      return yield* Effect.scoped(Effect.gen(function*() {
        const env = yield* Layer.build(layer(second))
        const resumed = yield* Effect.forkChild(Reminder.execute({ id: "a" }).pipe(Effect.provide(env)))
        yield* settle
        yield* TestClock.adjust(1099)
        yield* settle
        const earlyExit = resumed.pollUnsafe()
        yield* TestClock.adjust(1)
        // A run that waits longer than the journaled remainder fails here, not at the test deadline.
        for (let i = 0; i < 250 && resumed.pollUnsafe() === undefined; i++) yield* settle
        if (resumed.pollUnsafe() === undefined) return yield* Effect.die(new Error("the resumed run did not wake at 11 500"))
        const result = yield* Fiber.join(resumed)
        const kinds = Array.from(yield* Stream.runCollect(Stream.map(Durable.history(run), (entry) => entry.eventType)).pipe(Effect.provide(env)))
        return { scheduled: scheduled.map((entry) => entry.payload), statusAtCrash, early: earlyExit === undefined, result, kinds }
      }))
    }).pipe(Effect.provide(TestClock.layer())))
    // Due 1500 ms after the start: journaled once, as an absolute time.
    expect(out.scheduled).toEqual([{ name: "wait", wakeAt: 11_500 }])
    expect(out.statusAtCrash).not.toBe("succeeded")
    // At 11 499 the resumed run still waits; at 11 500 it finishes.
    expect(out.early).toBe(true)
    expect(out.result).toBe("remind:a")
    expect(out.kinds.filter((kind) => kind === "ClockScheduled").length).toBe(1)
    expect(out.kinds.at(-1)).toBe("RunCompleted")
  }, 20000)
})

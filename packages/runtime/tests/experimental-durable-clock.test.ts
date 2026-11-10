import { expect, test } from "bun:test"
import { Effect, Fiber, Layer, Schema, Stream } from "effect"
import { DurableClock } from "effect/workflow"
import { Durable } from "vibelang-runtime/experimental"

// A workflow that waits on a durable clock. inMemoryThreshold 0 sends every
// sleep through the engine's scheduleClock, as a sleep over a minute is.
const Reminder = Durable.workflow("clock#Reminder", { payload: { id: Schema.String }, success: Schema.String })
const layer = (store: Durable.Store) =>
  Reminder.toLayer(({ id }) =>
    Effect.as(DurableClock.sleep({ name: "wait", duration: "1500 millis", inMemoryThreshold: 0 }), `remind:${id}`)
  ).pipe(Layer.provideMerge(Durable.layerStore(store)))

test("a run killed while a durable clock runs wakes when the clock was due, not a full delay later", async () => {
  const store = Durable.makeMemoryStore()
  const started = Date.now()
  // The first engine starts the clock, then its process dies.
  const first = Effect.runFork(Reminder.execute({ id: "a" }).pipe(Effect.provide(layer(store))))
  await new Promise((resolve) => setTimeout(resolve, 400))
  await Effect.runPromise(Fiber.interrupt(first))
  const resumed = Date.now()
  expect(await Effect.runPromise(Reminder.execute({ id: "a" }).pipe(Effect.provide(layer(store))))).toBe("remind:a")
  const finished = Date.now()
  // Due 1500 ms after the start: the resumed run waits the rest, about 1100 ms.
  expect(finished - started).toBeGreaterThanOrEqual(1450)
  expect(finished - resumed).toBeLessThan(1400)
  const run = await Effect.runPromise(Reminder.executionId({ id: "a" }))
  const kinds = Array.from(
    await Effect.runPromise(Stream.runCollect(Stream.map(Durable.history(run), (entry) => entry.eventType)).pipe(
      Effect.provide(Durable.layerStore(store))
    ))
  )
  expect(kinds.filter((kind) => kind === "ClockScheduled").length).toBe(1)
  expect(kinds.at(-1)).toBe("RunCompleted")
}, 20000)

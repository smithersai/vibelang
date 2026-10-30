import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import { lateStartScheduler } from "../typescript/vibelang/late-start-scheduler.mjs"

const require = createRequire(new URL("../experiments/package.json", import.meta.url))
const { Deferred, Effect, Fiber, Scheduler } = await import(require.resolve("effect"))

test("late dispatch exposes sleep used as fork readiness", async () => {
  let started = false
  let released = false
  await Effect.runPromise(Effect.gen(function*() {
    const child = yield* Effect.forkChild(Effect.ensuring(Effect.gen(function*() {
      started = true
      yield* Effect.never
    }), Effect.sync(() => { released = true })))
    yield* Effect.sleep("5 millis")
    yield* Fiber.interrupt(child)
  }), { scheduler: lateStartScheduler(Scheduler) })
  assert.equal(started, false)
  assert.equal(released, false)
})

test("a Deferred waits for cleanup registration despite late dispatch", async () => {
  let released = false
  await Effect.runPromise(Effect.gen(function*() {
    const ready = yield* Deferred.make()
    const child = yield* Effect.forkChild(Effect.ensuring(Effect.gen(function*() {
      yield* Deferred.succeed(ready, undefined)
      yield* Effect.never
    }), Effect.sync(() => { released = true })))
    yield* Deferred.await(ready)
    yield* Fiber.interrupt(child)
  }), { scheduler: lateStartScheduler(Scheduler) })
  assert.equal(released, true)
})

test("flush drains delayed tasks once in priority order", async () => {
  const dispatcher = lateStartScheduler(Scheduler).makeDispatcher()
  const events = []
  dispatcher.scheduleTask(() => events.push("second"), 2)
  dispatcher.scheduleTask(() => events.push("first"), 1)
  dispatcher.flush()
  assert.deepEqual(events, ["first", "second"])
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.deepEqual(events, ["first", "second"])
})

test("late dispatch starts its delay after the parent yields", async () => {
  let started = false
  await Effect.runPromise(Effect.gen(function*() {
    const child = yield* Effect.forkChild(Effect.sync(() => { started = true }))
    // Simulate the OS pausing the parent between forking and sleeping. An
    // already-running delay could expire before the parent registers its timer.
    const until = performance.now() + 150
    while (performance.now() < until) {}
    yield* Effect.sleep("5 millis")
    yield* Fiber.interrupt(child)
  }), { scheduler: lateStartScheduler(Scheduler) })
  assert.equal(started, false)
})

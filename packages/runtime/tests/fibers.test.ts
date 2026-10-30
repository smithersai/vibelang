import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import {
  $await, $forConcurrent,
  $join, $select, detach, forkIn, join as preludeJoin
} from "vibelang-runtime"

// D167, D196, D225: these operands may contain already-running fibers.
// Joining a wrapper fiber alone does not stop those fibers on failure.
for (const [name, join] of [["join", $join], ["legacy await", $await]] as const) {
  describe(name, () => {
    test("keeps tuple and record shape, values, and written key order", async () => {
      await Effect.runPromise(Effect.gen(function*() {
        const ready = yield* Deferred.make<number>()
        const first = yield* Effect.forkChild(Deferred.await(ready))
        const second = yield* Effect.forkChild(Effect.succeed("second"))
        const waiting = yield* Effect.forkChild(join({ first, second }))
        yield* Deferred.succeed(ready, 42)
        const value = yield* Fiber.join(waiting)
        expect(value).toEqual({ first: 42, second: "second" })
        expect(Object.keys(value)).toEqual(["first", "second"])
        expect(yield* join([first, second] as const)).toEqual([42, "second"])
        expect(yield* join(first)).toBe(42)
        expect(yield* join([])).toEqual([])
        expect(yield* join({})).toEqual({})
      }))
    })

    test("failure interrupts already-running siblings and waits for cleanup", async () => {
      const events: string[] = []
      await Effect.runPromise(Effect.gen(function*() {
        const started = yield* Deferred.make<void>()
        const child = yield* Effect.forkChild(Effect.ensuring(
          Effect.andThen(Deferred.succeed(started, undefined), Effect.never),
          Effect.andThen(Effect.yieldNow, Effect.sync(() => { events.push("closed") }))
        ))
        yield* Deferred.await(started)
        const failed = yield* Effect.forkChild(Effect.fail("broken"))
        const exit = yield* Effect.exit(join({ child, failed }))
        expect(exit).toEqual(Exit.fail("broken"))
        expect(child.pollUnsafe()).toBeDefined()
        expect(events).toEqual(["closed"])
      }))
    })
  })
}

test("the prelude's join is the keyword's own function", () => {
  // D391, D432: join(x) with parentheses is the keyword while join resolves
  // to this binding.
  expect(preludeJoin).toBe($join)
})

test("legacy await accepts Deferred leaves, including nested runtime collections", async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const deferred = yield* Deferred.make<number>()
    yield* Deferred.succeed(deferred, 7)
    expect(yield* $await(deferred)).toBe(7)
    expect(yield* $await({ nested: [deferred] } as any)).toEqual({ nested: [7] })
    for (const value of [null, undefined, 1, "bad", () => 1]) {
      const exit = yield* Effect.exit($await(value))
      expect(Exit.isFailure(exit) && exit.cause.reasons.some(r => Cause.isDieReason(r) && r.defect instanceof TypeError)).toBe(true)
    }
  }))
})

test("select's default cancels pending cases and synchronous completion takes precedence", async () => {
  let closed = 0
  const pending = () => Effect.ensuring(Effect.never, Effect.sync(() => { closed++ }))
  expect(await Effect.runPromise($select(true, pending, pending))).toEqual({ index: -1, value: undefined })
  expect(closed).toBe(2)
  expect(await Effect.runPromise($select(true, () => Effect.succeed(7), pending))).toEqual({ index: 0, value: 7 })
  expect(closed).toBe(2)
})

test("for concurrent enforces its bound, starts distinct fibers, and joins every item", async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const atCapacity = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    let active = 0
    let maximum = 0
    const completed: number[] = []
    const ids = new Set<number>()
    const loop = yield* Effect.forkChild($forConcurrent([0, 1, 2, 3, 4, 5], 2, item => Effect.gen(function*() {
      ids.add((yield* Effect.fiber).id)
      active++
      maximum = Math.max(maximum, active)
      if (active === 2) yield* Deferred.succeed(atCapacity, undefined)
      yield* Deferred.await(gate)
      active--
      completed.push(item)
    })))
    yield* Deferred.await(atCapacity)
    expect(active).toBe(2)
    expect(completed).toEqual([])
    yield* Deferred.succeed(gate, undefined)
    expect(yield* Fiber.join(loop)).toBeUndefined()
    expect(maximum).toBe(2)
    expect(completed.sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(ids.size).toBe(6)
  }))
})

test("for concurrent failure interrupts active items and does not start queued items", async () => {
  const started: number[] = []
  const closed: number[] = []
  const exit = await Effect.runPromiseExit(Effect.gen(function*() {
    const ready = yield* Deferred.make<void>()
    return yield* $forConcurrent([0, 1, 2, 3], 2, item => Effect.ensuring(Effect.gen(function*() {
      started.push(item)
      if (item === 0) return yield* Effect.andThen(Deferred.succeed(ready, undefined), Effect.never)
      return yield* Effect.andThen(Deferred.await(ready), Effect.fail("item failed"))
    }), Effect.sync(() => { closed.push(item) })))
  }))
  expect(exit).toEqual(Exit.fail("item failed"))
  expect(started).toEqual([0, 1])
  expect(closed.sort()).toEqual([0, 1])
  expect(await Effect.runPromise($forConcurrent([], undefined, () => Effect.die("unreachable")))).toBeUndefined()
})

test("forkIn follows its supplied scope; detach survives the creating fiber", async () => {
  await Effect.runPromise(Effect.gen(function*() {
    const gate = yield* Deferred.make<number>()
    const creator = yield* Effect.forkChild(detach(Deferred.await(gate)))
    const detached = yield* Fiber.join(creator)
    expect(detached.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(gate, 42)
    expect(yield* Fiber.join(detached)).toBe(42)
    const scope = yield* Scope.make()
    const scoped = yield* forkIn(scope, Effect.never)
    yield* Scope.close(scope, Exit.void)
    expect(Exit.isFailure(scoped.pollUnsafe()!)).toBe(true)
  }))
})

test("join: interruption waits for the joined fibers' cleanup", async () => {
  const events: string[] = []
  await Effect.runPromise(Effect.gen(function*() {
    const started = yield* Deferred.make<void>()
    const held = yield* Effect.forkChild(Effect.ensuring(
      Effect.andThen(Deferred.succeed(started, undefined), Effect.never),
      Effect.andThen(Effect.yieldNow, Effect.sync(() => { events.push("closed") }))
    ))
    yield* Deferred.await(started)
    yield* Effect.ensuring(Effect.gen(function*() {
      const waiting = yield* Effect.forkChild($join([held]), { startImmediately: true })
      yield* Fiber.interrupt(waiting)
      expect(events).toEqual(["closed"])
      expect(held.pollUnsafe()).toBeDefined()
    }), Fiber.interrupt(held))
  }))
})

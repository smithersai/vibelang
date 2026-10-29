import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import {
  $catchExpression, $catchCause, $failureOf, $finallyExit, $fork,
  $isFailure, $noFailure, $provideEntries, $provideService, $region, $service, $using, acquireDisposable, acquireRelease,
  interrupt, interruptible, restore, uninterruptible, wire, yieldNow
} from "vibelang-runtime"

interface Counter { readonly value: number }
class Counter extends $service<Counter>("t2/Counter") {}
interface Left { readonly value: number }
class Left extends $service<Left>("t2/Left") {}
interface Right { readonly value: number }
class Right extends $service<Right>("t2/Right") {}

test("provide accepts a generated key, an Effect service, or its module", async () => {
  const CounterModule = { Counter }
  for (const provider of [
    $provideService(Counter, "Counter", { value: 42 }),
    $provideService(CounterModule, "Counter", { value: 42 })
  ]) {
    expect(await Effect.runPromise(Effect.provide(Counter, provider))).toEqual({ value: 42 })
  }
  const actualScope = await Effect.runPromise(Scope.make())
  try {
    expect(await Effect.runPromise(Effect.provide(Effect.scope, $provideService(Scope, "Scope", actualScope)))).toBe(actualScope)
  } finally {
    await Effect.runPromise(Scope.close(actualScope, Exit.void))
  }
  for (const invalid of [{}, { Counter: "not a key" }]) {
    expect(() => $provideService(invalid as any, "Counter", { value: 42 })).toThrow("Counter is not a service key")
  }
})

test("$provideEntries provides Key = value services without a Layer, and builds only the other layers", async () => {
  const memoMap = Effect.map(Effect.serviceOption(Layer.CurrentMemoMap), (option) => option._tag)
  const probe = Effect.all([Counter, Left, memoMap])
  const one = $provideEntries(Effect.all([Counter, memoMap]), [$provideService(Counter, "Counter", { value: 0 })])
  expect(await Effect.runPromise(one)).toEqual([{ value: 0 }, "None"])
  const services = $provideEntries(probe, [
    $provideService(Counter, "Counter", { value: 1 }),
    $provideService({ Left }, "Left", { value: 2 }),
    $provideService(Counter, "Counter", { value: 3 })
  ])
  expect(await Effect.runPromise(services)).toEqual([{ value: 3 }, { value: 2 }, "None"])
  const mixed = $provideEntries([Layer.succeed(Counter)({ value: 4 }), $provideService(Left, "Left", { value: 5 })])(probe)
  expect(await Effect.runPromise(mixed)).toEqual([{ value: 4 }, { value: 5 }, "Some"])
})

test("wire shares a resource layer across dependents and builds fresh for each provide", async () => {
  let built = 0
  let released = 0
  const base = Layer.effect(Counter, Effect.acquireRelease(
    Effect.sync(() => ({ value: ++built })),
    () => Effect.sync(() => { released++ })
  ))
  const left = Layer.effect(Left, Effect.map(Counter, c => ({ value: c.value + 10 })))
  const right = Layer.effect(Right, Effect.map(Counter, c => ({ value: c.value + 20 })))
  const composed = wire(left, right, base)
  const program = Effect.gen(function*() {
    const first = yield* Counter
    const second = yield* Counter
    expect(first).toBe(second)
    return [(yield* Left).value, (yield* Right).value]
  })
  expect(built).toBe(0)
  expect(await Effect.runPromise(Effect.provide(program, composed))).toEqual([11, 21])
  expect([built, released]).toEqual([1, 1])
  expect(await Effect.runPromise(Effect.provide(program, composed))).toEqual([12, 22])
  expect([built, released]).toEqual([2, 2])
})

test("wire preserves failed setup and releases dependencies before failure escapes", async () => {
  let released = false
  const base = Layer.effect(Counter, Effect.acquireRelease(Effect.succeed({ value: 1 }), () => Effect.sync(() => { released = true })))
  const failed = Layer.effect(Left, Effect.andThen(Counter, Effect.fail("setup failed")))
  expect(await Effect.runPromiseExit(Effect.provide(Left, wire(failed, base)))).toEqual(Exit.fail("setup failed"))
  expect(released).toBe(true)
})

test("a region owns only using acquisitions and leaves ordinary resources with its caller", async () => {
  const events: string[] = []
  const acquire = (name: string) => Effect.acquireRelease(Effect.succeed(name), () => Effect.sync(() => { events.push(name) }))
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    yield* $region(scope => Effect.gen(function*() {
      yield* acquire("caller")
      yield* $using(scope, acquire("block"))
    }))
    expect(events).toEqual(["block"])
  })))
  expect(events).toEqual(["block", "caller"])
})

test("a region closes children before earlier using resources", async () => {
  const events: string[] = []
  await Effect.runPromise($region(scope => Effect.gen(function*() {
    yield* $using(scope, Effect.acquireRelease(Effect.void, () => Effect.sync(() => { events.push("resource") })))
    const started = yield* Deferred.make<void>()
    yield* $fork(Effect.ensuring(
      Effect.andThen(Deferred.succeed(started, undefined), Effect.never),
      Effect.andThen(Effect.yieldNow, Effect.sync(() => { events.push("child") }))
    ), scope)
    yield* Deferred.await(started)
  })))
  expect(events).toEqual(["child", "resource"])
})

for (const masked of [true, false]) {
  // $using is Effect.acquireRelease with { interruptible: true } (D490), so
  // the acquisition's own policy decides.
  // Masked: the interruption waits for the acquisition, which recorded the
  // Disposable's release, so that release alone runs (D401). Interruptible:
  // the interruption reaches the wait, and nothing is acquired.
  test(`using ${masked ? "masked" : "interruptible"} acquisition handles cancellation without leaking`, async () => {
    const events: string[] = []
    await Effect.runPromise(Effect.gen(function*() {
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const acquire = acquireRelease(Effect.gen(function*() {
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(gate)
        events.push("acquired")
        return { [Symbol.dispose]() { events.push("disposed") } }
      }), () => Effect.sync(() => { events.push("released") }), { interruptible: !masked })
      const child = yield* Effect.forkChild($region(scope => $using(scope, acquire)))
      yield* Deferred.await(entered)
      child.interruptUnsafe(98765)
      if (masked) {
        expect(child.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(gate, undefined)
      }
      const exit = yield* Fiber.await(child)
      expect(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true)
    }))
    expect(events).toEqual(masked ? ["acquired", "released"] : [])
  })
}

// D401: only an acquisition's record decides that using adds no release. The
// runtime's acquisitions record the value in the Scope they registered its
// release in; a value they did not record there, Effect's own acquisition's
// included, is disposed by using once.
test("using adopts a release only from an acquisition's record", async () => {
  const events: string[] = []
  const handle = (name: string) => ({ [Symbol.dispose]() { events.push(`dispose ${name}`) } })
  const released = (name: string) => () => Effect.sync(() => { events.push(`release ${name}`) })
  await Effect.runPromise($region(scope => Effect.gen(function*() {
    yield* $using(scope, acquireRelease(Effect.succeed(handle("recorded")), released("recorded")))
    yield* $using(scope, acquireDisposable(Effect.succeed(handle("disposable"))))
    yield* $using(scope, Effect.acquireRelease(Effect.succeed(handle("effect's")), released("effect's")))
    yield* $using(scope, Effect.andThen(Scope.Scope, Effect.succeed(handle("scope only"))))
    const outside = yield* Effect.scoped(acquireRelease(Effect.succeed(handle("elsewhere")), released("elsewhere")))
    yield* $using(scope, Effect.succeed(outside), { requiresScope: false })
  })))
  expect(events).toEqual([
    "release elsewhere",
    "dispose elsewhere",
    "dispose scope only",
    "dispose effect's",
    "release effect's",
    "dispose disposable",
    "release recorded"
  ])
})

// D343: the disposal method is read once, at registration, asyncDispose first,
// and called with the value as this; a promise it returns is awaited.
test("using reads a value's disposal method once, Symbol.asyncDispose first", async () => {
  const events: string[] = []
  const both = {
    name: "both",
    [Symbol.dispose]() { events.push(`dispose ${this.name}`) },
    async [Symbol.asyncDispose]() {
      await new Promise(resolve => setTimeout(resolve, 5))
      events.push(`async dispose ${this.name}`)
    }
  }
  const replaced: Disposable = { [Symbol.dispose]() { events.push("original") } }
  await Effect.runPromise($region(scope => Effect.gen(function*() {
    yield* $using(scope, Effect.succeed(both), { requiresScope: false })
    yield* $using(scope, Effect.succeed(replaced), { requiresScope: false })
    replaced[Symbol.dispose] = () => { events.push("replacement") }
  })))
  expect(events).toEqual(["original", "async dispose both"])
})

// D401: a value with no disposal method fails at the declaration with a
// TypeError, a defect, unless the initializer requires Scope or the value is
// null or undefined.
test("a using value with no disposal method is a TypeError unless the initializer requires Scope", () => {
  const exit = Effect.runSyncExit($region(scope => $using(scope, Effect.succeed({ name: "plain" }), { requiresScope: false })))
  expect(Exit.isFailure(exit) && exit.cause.reasons.find(Cause.isDieReason)?.defect).toBeInstanceOf(TypeError)
  for (const value of [null, undefined]) {
    expect(Effect.runSync($region(scope => $using(scope, Effect.succeed(value), { requiresScope: false })))).toBe(value)
  }
  expect(Effect.runSync($region(scope => $using(scope, Effect.succeed({ name: "scoped" }), { requiresScope: true })))).toEqual({ name: "scoped" })
})

// D490: $using is one program for every initializer, whether the compiler
// passes requiresScope or not: Effect.acquireRelease with { interruptible:
// true }, whose restore runs the initializer as yield* would. An
// interruption that arrives at a wait in the initializer ends the wait, and
// nothing is acquired. One that arrives while the initializer runs in a mask
// of its own is delivered as that mask ends, inside the initializer, as
// Effect delivers it, so the value never reaches $using and is not disposed
// (scopes-using-pending-interrupt).
for (const [ending, requiresScope, expected] of [
  ["in its own mask", false, ["acquired"]],
  ["in a wait", false, []],
  ["in a wait", true, []]
] as const) {
  test(`using of an initializer interrupted ${ending}, requiresScope ${requiresScope}, follows Effect`, async () => {
    const events: string[] = []
    await Effect.runPromise(Effect.gen(function*() {
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const open = Effect.gen(function*() {
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(gate)
        events.push("acquired")
        return { [Symbol.dispose]() { events.push("disposed") } }
      })
      const initializer = ending === "in its own mask" ? Effect.uninterruptible(open) : open
      const child = yield* Effect.forkChild($region(scope => Effect.andThen($using(scope, initializer, { requiresScope }), Effect.sync(() => { events.push("body") }))))
      yield* Deferred.await(entered)
      child.interruptUnsafe(98765)
      yield* Deferred.succeed(gate, undefined)
      const exit = yield* Fiber.await(child)
      expect(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true)
    }))
    expect(events).toEqual([...expected])
  })
}

// The mask ends when the release is registered: the block's body stays interruptible.
test("using leaves the block's body interruptible", async () => {
  const events: string[] = []
  await Effect.runPromise(Effect.gen(function*() {
    const entered = yield* Deferred.make<void>()
    const child = yield* Effect.forkChild($region(scope => Effect.gen(function*() {
      yield* $using(scope, Effect.sync(() => ({ [Symbol.dispose]() { events.push("disposed") } })), { requiresScope: false })
      yield* Deferred.succeed(entered, undefined)
      return yield* Effect.never
    })))
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(child)
  }))
  expect(events).toEqual(["disposed"])
})

// D490: using adds no mask of its own and records no interruptibility, so an
// interruptible acquisition is cut at its wait inside any using initializer,
// a nested using's included, unless a mask written there covers it.
for (const [outer, inner, expected] of [
  ["non-Scope", "a nested using", []],
  ["Scope", "a nested using", []],
  ["Scope", "uninterruptible", ["acquired", "released"]]
] as const) {
  test(`an interruptible acquisition in ${inner} inside a ${outer} using initializer follows Effect`, async () => {
    const events: string[] = []
    await Effect.runPromise(Effect.gen(function*() {
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const acquire = acquireRelease(Effect.gen(function*() {
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(gate)
        events.push("acquired")
        return { name: "socket" }
      }), () => Effect.sync(() => { events.push("released") }), { interruptible: true })
      const initializer = inner === "uninterruptible"
        ? uninterruptible(acquire)
        : $region(scope => $using(scope, acquire, { requiresScope: true }))
      const child = yield* Effect.forkChild($region(scope => $using(scope, initializer, { requiresScope: outer === "Scope" })))
      yield* Deferred.await(entered)
      child.interruptUnsafe(98765)
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(child)
    }))
    expect(events).toEqual([...expected])
  })
}

// Effect 4.1.0 defect precedence (Effect-TS/effect#9433): the body's
// typed failure becomes a defect beside the Disposable's.
test("a Disposable defect is retained beside a body failure, which becomes a defect; other finalizers still run", () => {
  const events: string[] = []
  const defect = new Error("dispose failed")
  const exit = Effect.runSyncExit($region(scope => Effect.gen(function*() {
    yield* $using(scope, Effect.succeed({ [Symbol.dispose]() { events.push("last") } }))
    yield* $using(scope, Effect.succeed({ [Symbol.dispose]() { throw defect } }))
    return yield* Effect.fail("body failed")
  })))
  expect(events).toEqual(["last"])
  expect(Exit.isFailure(exit) && exit.cause.reasons.map(r => r._tag)).toEqual(["Die", "Die"])
  expect(Exit.isFailure(exit) && exit.cause.reasons.map(r => (r as Cause.Die).defect)).toEqual(["body failed", defect])
})

test("using disposes callable resources at block exit", () => {
  const events: string[] = []
  const resource: (() => void) & Disposable = Object.assign(() => {}, {
    [Symbol.dispose]() { events.push("disposed") }
  })
  Effect.runSync($region(scope => Effect.gen(function*() {
    yield* $using(scope, Effect.succeed(resource))
    events.push("body")
  })))
  expect(events).toEqual(["body", "disposed"])
})

test("using awaits disposal of callable async resources at block exit", async () => {
  const events: string[] = []
  const resource: (() => void) & AsyncDisposable = Object.assign(() => {}, {
    async [Symbol.asyncDispose]() {
      events.push("disposing")
      await Promise.resolve()
      events.push("disposed")
    }
  })
  await Effect.runPromise($region(scope => Effect.gen(function*() {
    yield* $using(scope, Effect.succeed(resource))
    events.push("body")
  })))
  expect(events).toEqual(["body", "disposing", "disposed"])
})

const asyncResource = (events: string[], name: string, ms = 5): AsyncDisposable => ({
  async [Symbol.asyncDispose]() {
    await new Promise(resolve => setTimeout(resolve, ms))
    events.push(`async dispose ${name}`)
  }
})

test("using awaits Symbol.asyncDispose of a value whose acquisition registers no release", async () => {
  const events: string[] = []
  const open = <A>(name: string, value: A) => Effect.sync(() => { events.push(`open ${name}`); return value })
  await Effect.runPromise($region(scope => Effect.gen(function*() {
    yield* $using(scope, open("a", { [Symbol.dispose]() { events.push("dispose a") } }))
    yield* $using(scope, open("b", asyncResource(events, "b", 10)))
    yield* $using(scope, open("c", asyncResource(events, "c", 1)))
    events.push("body")
  })))
  expect(events).toEqual(["open a", "open b", "open c", "body", "async dispose c", "async dispose b", "dispose a"])
})

test("using releases on failure and interruption with Symbol.asyncDispose", async () => {
  const events: string[] = []
  const failed = await Effect.runPromiseExit($region(scope => Effect.gen(function*() {
    yield* $using(scope, Effect.succeed(asyncResource(events, "failed")))
    return yield* Effect.fail("body failed")
  })))
  expect(failed).toEqual(Exit.fail("body failed"))
  await Effect.runPromise(Effect.gen(function*() {
    const entered = yield* Deferred.make<void>()
    const child = yield* Effect.forkChild($region(scope => Effect.gen(function*() {
      yield* $using(scope, Effect.succeed(asyncResource(events, "interrupted")))
      yield* Deferred.succeed(entered, undefined)
      return yield* Effect.never
    })))
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(child)
  }))
  expect(events).toEqual(["async dispose failed", "async dispose interrupted"])
})

test("a recorded acquisition keeps its own release, for a Disposable and an AsyncDisposable (D401)", async () => {
  const events: string[] = []
  const released = (name: string) => () => Effect.sync(() => { events.push(`release ${name}`) })
  const both = {
    [Symbol.dispose]() { events.push("dispose both") },
    async [Symbol.asyncDispose]() { events.push("async dispose both") }
  }
  await Effect.runPromise($region(scope => Effect.gen(function*() {
    yield* $using(scope, acquireRelease(Effect.succeed(asyncResource(events, "own")), released("own")))
    yield* $using(scope, acquireRelease(Effect.succeed({ [Symbol.dispose]() { events.push("dispose sync") } }), released("sync")))
    yield* $using(scope, Effect.succeed(both))
    yield* $using(scope, Effect.succeed(null))
  })))
  expect(events).toEqual(["async dispose both", "release sync", "release own"])
})

test("a Symbol.asyncDispose rejection is a defect beside the block's exit; earlier releases still run", async () => {
  const events: string[] = []
  const defect = new Error("async dispose failed")
  const exit = await Effect.runPromiseExit($region(scope => Effect.gen(function*() {
    yield* $using(scope, Effect.succeed({ [Symbol.dispose]() { events.push("first") } }))
    yield* $using(scope, Effect.succeed({ [Symbol.asyncDispose]: () => Promise.reject(defect) }))
    return "body"
  })))
  expect(events).toEqual(["first"])
  expect(Exit.isFailure(exit) && exit.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect)
})

test("catch expressions are lazy, recover only expected causes, and keep handler effects", async () => {
  let starts = 0
  let caught = 0
  const program = $catchExpression(() => { starts++; return Effect.succeed(42) }, () => Effect.sync(() => ++caught))
  expect(starts).toBe(0)
  expect(Effect.runSync(program)).toBe(42)
  expect(Effect.runSync(program)).toBe(42)
  expect([starts, caught]).toEqual([2, 0])
  expect(Effect.runSync($catchExpression(() => Effect.fail("bad"), e => Effect.succeed(`caught:${e}`)))).toBe("caught:bad")
  for (const cause of [Cause.die("defect"), Cause.interrupt(123)]) {
    expect(await Effect.runPromiseExit($catchExpression(() => Effect.failCause(cause), () => Effect.sync(() => ++caught)))).toEqual(Exit.failCause(cause))
  }
  // A failure beside an interruption is recovered, as Effect.catch recovers it (D306).
  expect(Effect.runSync($catchExpression(() => Effect.failCause(Cause.combine(Cause.interrupt(123), Cause.fail("bad"))), e => Effect.succeed(`caught:${e}`)))).toBe("caught:bad")
  // A failure beside a defect passes as a defect (D305).
  const mixed = await Effect.runPromiseExit($catchExpression(() => Effect.failCause(Cause.combine(Cause.fail("bad"), Cause.die("defect"))), () => Effect.sync(() => ++caught)))
  expect(Exit.isFailure(mixed) && mixed.cause.reasons.map(r => r._tag === "Die" ? r.defect : r._tag)).toEqual(["bad", "defect"])
  expect(caught).toBe(0)
})

test("cause helpers preserve all reasons, distinguish undefined failures from no failure, and skip a failure beside a defect", () => {
  const mixed = Cause.combine(Cause.die("defect"), Cause.combine(Cause.fail(undefined), Cause.fail("second")))
  // A typed clause before a Cause clause never sees a failure beside a defect (D305).
  expect($failureOf(mixed)).toBe($noFailure)
  expect($failureOf(Cause.combine(Cause.fail(undefined), Cause.fail("second")))).toBeUndefined()
  expect($failureOf(Cause.combine(Cause.interrupt(123), Cause.fail("second")))).toBe("second")
  expect($failureOf(Cause.interrupt(123))).toBe($noFailure)
  expect(Effect.runSync($catchCause(Effect.failCause(mixed), cause => Effect.succeed(cause)))).toEqual(mixed)
  Effect.runSync(Effect.gen(function*() {
    const id = yield* Effect.fiberId
    expect(yield* $catchCause(interrupt(), cause => Effect.succeed(cause))).toEqual(Cause.interrupt(id))
  }))
  expect($isFailure({ _tag: "Missing" }, "Invalid", "Missing")).toBe(true)
  for (const value of [null, undefined, "Missing", {}, { _tag: "Other" }]) expect($isFailure(value, "Missing")).toBe(false)
})

// The finalizer sees the body's own Exit; the combined cause gives defects
// precedence, as Effect.onExit does in Effect 4.1.0 (Effect-TS/effect#9433).
test("finally Exit sees void on success, preserves failure, and retains cleanup failures", () => {
  let observed: unknown
  expect(Effect.runSync($finallyExit(Effect.succeed(42), exit => Effect.sync(() => { observed = exit })))).toBe(42)
  expect(observed).toEqual(Exit.void)
  const cause = Cause.combine(Cause.fail("body"), Cause.die("defect"))
  const exit = Effect.runSyncExit($finallyExit(Effect.failCause(cause), exit => {
    observed = exit
    return Effect.fail("cleanup")
  }))
  expect(observed).toEqual(Exit.failCause(cause))
  expect(Exit.isFailure(exit) && exit.cause.reasons.map(r => r._tag)).toEqual(["Die", "Die", "Die"])
  expect(Exit.isFailure(exit) && exit.cause.reasons.map(r => (r as Cause.Die).defect)).toEqual(["body", "defect", "cleanup"])
  // Without a defect, both typed failures stay typed.
  const typed = Effect.runSyncExit($finallyExit(Effect.fail("body"), () => Effect.fail("cleanup")))
  expect(Exit.isFailure(typed) && typed.cause.reasons.map(r => r._tag === "Fail" ? r.error : r._tag)).toEqual(["body", "cleanup"])
})

test("nested masks restore the innermost region's previous interruptibility", async () => {
  const status = Effect.withFiber(fiber => Effect.succeed((fiber as any).interruptible))
  expect(await Effect.runPromise(restore(Effect.succeed(42)))).toBe(42)
  expect(await Effect.runPromise(uninterruptible(Effect.gen(function*() {
    return [yield* status, yield* restore(status), yield* uninterruptible(restore(status)), yield* interruptible(status), yield* status]
  })))).toEqual([false, true, false, true, false])
  await Effect.runPromise(yieldNow())
  await Effect.runPromise(yieldNow(2))
})

for (const [name, makeInterruptible] of [["restore", restore], ["interruptible", interruptible]] as const) {
  test(`${name} delivers pending interruption before the next statement and masks finalization`, async () => {
    const events: string[] = []
    await Effect.runPromise(Effect.gen(function*() {
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const child = yield* Effect.forkChild($finallyExit(uninterruptible(Effect.gen(function*() {
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(gate)
        events.push("masked")
        yield* makeInterruptible(Effect.sync(() => { events.push("too late") }))
      })), exit => Effect.gen(function*() {
        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* Effect.withFiber(fiber => Effect.succeed((fiber as any).interruptible))).toBe(false)
        yield* Effect.yieldNow
        events.push("finalized")
      })))
      yield* Deferred.await(entered)
      child.interruptUnsafe(12345)
      expect(child.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(child)
    }))
    expect(events).toEqual(["masked", "finalized"])
  })
}

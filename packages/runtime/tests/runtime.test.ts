import { expect, test } from "bun:test"
import { Cause, Context, Deferred, Fiber, Stream } from "effect"
import {
  $bind, $catch, $caught, $control, $expected, $finally, $finallyFailure, $joinedFrame, $plainOf, $plainSync, $fork, $forOf, $normal, acquireRelease,
  $produce, $program, $programs, $reference, $region, $service, $tailResume,
  $tailResumeWith, $trusted, $trustedPlain, $using, $yield, $yieldAll, abandon, Control,
  $direct, Effect, Exit, fork, handle, handoff, Layer, pipe, resume,
  resumeWith, runMain, Schema, Scope, suspend, TaggedError, wire
} from "vibelang-runtime"

test("calls: programs are lazy and rerunnable; bind accepts data and Effects", async () => {
  let runs = 0
  const program = $program(() => Effect.sync(() => ++runs))
  const programs = $programs([() => program, () => $bind(9)])
  const record = $programs({ a: () => program, b: () => $bind("b") })
  expect(runs).toBe(0)
  expect(await Effect.runPromise(Effect.all(programs))).toEqual([1, 9])
  expect(await Effect.runPromise(Effect.all(record))).toEqual({ a: 2, b: "b" })
  expect(await Effect.runPromise($bind(program))).toBe(3)
  expect(await runMain(Effect.fail("expected"))).toEqual(Exit.fail("expected"))
})

// A failure beside a defect passes as a defect, as Effect 4.1.0's typed
// recovery passes it (Effect-TS/effect#9516, D305).
test("regions: catch handles expected failures and leaves defects alone, with a failure beside one as a defect", async () => {
  let caught = 0
  const recover = (e: string) => Effect.sync(() => { caught++; return `caught:${e}` })
  expect(Effect.runSync($catch(Effect.fail("no"), recover))).toBe("caught:no")
  const defect = new Error("defect")
  const mixed = Cause.combine(Cause.fail("no"), Cause.die(defect))
  for (const [cause, defects] of [[Cause.die(defect), [defect]], [mixed, ["no", defect]]] as const) {
    const exit = await Effect.runPromiseExit($catch(Effect.failCause(cause), recover))
    expect(Exit.isFailure(exit) && exit.cause.reasons.map(r => r._tag)).toEqual(defects.map(() => "Die"))
    expect(Exit.isFailure(exit) && exit.cause.reasons.map(r => (r as Cause.Die).defect)).toEqual([...defects])
  }
  expect(caught).toBe(1)
})

test("regions: a plain-JavaScript catch receives expected failures and rethrows defects", () => {
  const plain = (fail: unknown) => {
    try {
      if (fail instanceof Error) throw fail
      throw $expected(fail)
    } catch (e) {
      return $caught(e)
    }
  }
  expect(plain("expected")).toBe("expected")
  const defect = new TypeError("defect")
  expect(() => plain(defect)).toThrow(defect)
})

// D446: a plain function's Effect form records its plain form, which
// $plainOf calls before the function's module has attached f[$direct], as
// in a module cycle, and f[$direct] after.
test("fastcalls: $plainOf reaches a plain form before and after its attachment", () => {
  const calls: Array<unknown> = []
  const double$direct = function(this: unknown, n: number) {
    calls.push(this)
    return n * 2
  }
  const double = function(this: unknown, ...args: Array<number>) {
    return $plainSync(double$direct, this, args)
  } as ((n: number) => Effect.Effect<number>) & { [$direct]?: unknown }
  const early = $plainOf(double) as (this: unknown, n: number) => number
  const receiver = { early }
  expect(receiver.early(3)).toBe(6)
  expect(calls).toEqual([receiver])
  expect([1, 2].map($plainOf(double) as (n: number) => number)).toEqual([2, 4])
  double[$direct] = double$direct
  expect($plainOf(double)).toBe(double$direct)
  expect(early.call(undefined, 4)).toBe(8)
  expect(Effect.runSync(double(5))).toBe(10)
  expect($plainOf(7)).toBe(7)
})

test("fastcalls: $plainOf defects at the call when no plain form is recorded", async () => {
  let runs = 0
  const effectful = function missingPlain(n: number) {
    return Effect.sync(() => { runs++; return n * 2 })
  }
  const plain = $plainOf(effectful) as (n: number) => number
  expect(runs).toBe(0)
  expect(() => plain(3)).toThrow(/missingPlain.*plain form/)
  const bound = $plainOf(effectful.bind(undefined)) as (n: number) => number
  expect(() => bound(3)).toThrow(/bound missingPlain.*plain form/)
  const noForm = () => 7
  expect(() => ($plainOf(noForm) as () => number)()).toThrow(/noForm.*plain signature/)
  const exit = await Effect.runPromiseExit(Effect.sync(() => plain(3)))
  expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  expect(runs).toBe(0)
})

// D15: a plain finally block's failure joins the one in flight, that one
// first, as $finally's Effect.onExit joins them; the lowering writes this
// shape (visitPlainTryStatement).
test("regions: a plain-JavaScript finally joins its failure to the one in flight", () => {
  const plain = (body: () => void, cleanup: () => void) => {
    try {
      let pending: unknown = $normal
      try {
        body()
      } catch (thrown) {
        pending = thrown
        throw thrown
      } finally {
        try {
          cleanup()
        } catch (thrown) {
          throw $finallyFailure(pending, thrown)
        }
      }
      return "completed"
    } catch (e) {
      return $caught(e)
    }
  }
  const thrown = (f: () => unknown) => {
    try {
      return { returned: f() }
    } catch (e) {
      return { thrown: e }
    }
  }
  const fail = (error: unknown) => () => {
    throw $expected(error)
  }
  const defect = new TypeError("defect")
  const crash = () => {
    throw defect
  }
  expect(plain(fail("first"), fail("cleanup"))).toBe("first")
  expect(plain(() => {}, fail("cleanup"))).toBe("cleanup")
  expect(plain(() => {}, () => {})).toBe("completed")
  // D340: two failures with a defect leave as a SuppressedError, the
  // cleanup's exception first.
  const both = thrown(() => plain(fail("first"), crash)).thrown as SuppressedError
  expect(both).toBeInstanceOf(SuppressedError)
  expect([both.error, both.suppressed]).toEqual([defect, "first"])
  const reversed = thrown(() => plain(crash, fail("cleanup"))).thrown as SuppressedError
  expect([reversed.error, reversed.suppressed]).toEqual(["cleanup", defect])
  // Another finally joins it as the cause it stands for.
  const third = new RangeError("third")
  const nested = thrown(() => plain(() => plain(fail("first"), crash), () => { throw third })).thrown as SuppressedError
  expect(nested.error).toBe(third)
  expect([(nested.suppressed as SuppressedError).error, (nested.suppressed as SuppressedError).suppressed]).toEqual([defect, "first"])
  // An Effect frame sees every reason, in order, as Effect.onExit joins them.
  const dies = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit) ? exit.cause.reasons.map((reason) => Cause.isDieReason(reason) ? reason.defect : reason._tag) : "success"
  expect(dies(Effect.runSyncExit($plainSync(plain, undefined, [fail("first"), crash])))).toEqual(["first", defect])
  expect(dies(Effect.runSyncExit($plainSync(plain, undefined, [() => plain(fail("first"), crash), () => { throw third }])))).toEqual(["first", defect, third])
  expect(dies(Effect.runSyncExit(Effect.gen($joinedFrame(function*() {
    yield* Effect.void
    return plain(crash, fail("cleanup"))
  }))))).toEqual([defect, "cleanup"])
  // Any other exception stays one defect, and a value passes through.
  expect(dies(Effect.runSyncExit($plainSync(crash, undefined, [])))).toEqual([defect])
  expect(Effect.runSync($plainSync(() => 7, undefined, []))).toBe(7)
  expect(dies(Effect.runSyncExit(Effect.gen($joinedFrame(function*() {
    yield* Effect.void
    return crash()
  }))))).toEqual([defect])
})

test("regions: finally runs and completes when its body is interrupted", async () => {
  const events: string[] = []
  await Effect.runPromise(Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const child = yield* Effect.forkChild($finally(
      Effect.andThen(Deferred.succeed(started, undefined), Effect.never),
      Effect.andThen(Effect.yieldNow, Effect.sync(() => { events.push("finally") }))
    ))
    yield* Deferred.await(started)
    yield* Fiber.interrupt(child)
    events.push("joined")
  }))
  expect(events).toEqual(["finally", "joined"])
})

test("regions: using releases resources and Disposables in reverse acquisition order", () => {
  const events: string[] = []
  const acquire = (name: string) => Effect.acquireRelease(
    Effect.sync(() => { events.push(`acquire:${name}`); return name }),
    () => Effect.sync(() => { events.push(`release:${name}`) })
  )
  Effect.runSync($region(scope => Effect.gen(function* () {
    yield* $using(scope, acquire("outer"))
    yield* $using(scope, Effect.succeed({ [Symbol.dispose]() { events.push("dispose") } }))
    yield* $using(scope, acquire("inner"))
    events.push("body")
  })))
  expect(events).toEqual(["acquire:outer", "acquire:inner", "body", "release:inner", "dispose", "release:outer"])
})

test("fork: exiting a block interrupts its child and waits for cleanup", async () => {
  const events: string[] = []
  await Effect.runPromise($region(scope => Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    yield* $fork($finally(
      Effect.andThen(Deferred.succeed(started, undefined), Effect.never),
      Effect.sync(() => { events.push("child:closed") })
    ), scope)
    yield* Deferred.await(started)
    events.push("block:exit")
  })))
  expect(events).toEqual(["block:exit", "child:closed"])
  await Effect.runPromise(Effect.scoped(Effect.asVoid(fork(Effect.void))))
})

test("regions: using keeps each acquisition's own interruptibility (D25, D401)", async () => {
  const events: string[] = []
  const slow = (interruptible: boolean) => acquireRelease(
    Effect.andThen(Effect.sleep("20 millis"), Effect.sync(() => { events.push(`acquired:${interruptible}`) })),
    () => Effect.sync(() => { events.push(`released:${interruptible}`) }),
    { interruptible }
  )
  const timedOut = async (interruptible: boolean) =>
    Exit.isFailure(await Effect.runPromiseExit(Effect.timeout($region(scope => $using(scope, slow(interruptible))), "5 millis")))
  expect(await timedOut(false)).toBe(true)
  expect(await timedOut(true)).toBe(true)
  expect(events).toEqual(["acquired:false", "released:false"])
})

test("fork: a block's fork passes its options to forkIn", async () => {
  const events: string[] = []
  await Effect.runPromise($region(scope => Effect.gen(function* () {
    yield* $fork(Effect.sync(() => { events.push("child") }), scope, { startImmediately: true })
    events.push("parent")
  })))
  expect(events).toEqual(["child", "parent"])
})

interface Settings { readonly value: number }
class Settings extends $service<Settings>("runtime-test/Settings") {}
interface Doubled { readonly value: number }
class Doubled extends $service<Doubled>("runtime-test/Doubled") {}

test("services: service keys and dependent-first wire provide implementations", async () => {
  const settings = Layer.succeed(Settings, { value: 21 })
  const doubled = Layer.effect(Doubled, Effect.map(Settings, s => ({ value: s.value * 2 })))
  const program = Effect.map(Doubled, d => d.value)
  expect(await Effect.runPromise(Effect.provide(program, wire(doubled, settings)))).toBe(42)
})

interface Flags { readonly beta: boolean }
class Flags extends $reference<Flags>("runtime-test/Flags", () => Flags.defaultValue()) {
  static readonly defaultValue = (): Flags => ({ beta: false })
}

test("services: a reference key reads its class's default until a provider overrides it", async () => {
  const beta = Effect.map(Flags, f => f.beta)
  expect(await Effect.runPromise(beta)).toBe(false)
  expect(await Effect.runPromise(Effect.provideService(beta, Flags, { beta: true }))).toBe(true)
})

interface Ask { answer(question: string): Effect.Effect<number> }
class Ask extends $service<Ask>("runtime-test/Ask") {}
$control(Ask, ["answer"])
const asking = Effect.gen(function* () { return (yield* (yield* Ask).answer("life")) + 1 })

test("handlers: resume reinstalls the continuation and onReturn transforms its result", async () => {
  expect(await Effect.runPromise(handle(asking, Ask, {
    answer(question, k) {
      expect(question).toBe("life")
      return resume(k, 41)
    }
  }))).toBe(42)
  expect(await Effect.runPromise(handle(asking, Ask, {
    answer: (_, k) => resumeWith(k, Effect.succeed(20))
  }, value => Effect.succeed(value * 2)))).toBe(42)
})

interface Logger { write(message: string, level?: string): Effect.Effect<string> }
class Logger extends $service<Logger>("runtime-test/Logger") {}
$control(Logger, ["write"], [2])

test("handlers: a clause gets its continuation last when a call leaves an optional argument out", async () => {
  const write = (level?: string) =>
    Effect.gen(function* () {
      const logger = yield* Logger
      return yield* (level === undefined ? logger.write("hi") : logger.write("hi", level))
    })
  const clauses = {
    write: (message: string, level: string | undefined, k: any) => resume(k, `${message}/${level ?? "default"}`)
  }
  expect(await Effect.runPromise(handle(write(), Logger, clauses))).toBe("hi/default")
  expect(await Effect.runPromise(handle(write("warn"), Logger, clauses))).toBe("hi/warn")
})

test("handlers: tail resumption and abandonment preserve their generated shapes", async () => {
  expect(await Effect.runPromise(handle(asking, Ask, {
    answer: (_, k) => Effect.succeed($tailResume(k, 41))
  }))).toBe(42)
  expect(await Effect.runPromise(handle(asking, Ask, {
    answer: (_, k) => Effect.succeed($tailResumeWith(k, Effect.succeed(41)))
  }))).toBe(42)
  const events: string[] = []
  const program = $finally(asking, Effect.sync(() => { events.push("closed") }))
  const exit = await Effect.runPromiseExit(handle(program, Ask, {
    answer: (_, k) => Effect.andThen(abandon(k), Effect.succeed(0))
  }))
  expect(exit).toEqual(Exit.succeed(0))
  expect(events).toEqual(["closed"])
})

const numbers = () => $produce(() => Effect.gen(function* () {
  yield* $yield(1)
  yield* $yield(2)
  yield* $yield(3)
}))

test("producers: a producer is a cold Stream; forOf iterates it and break closes it", async () => {
  const events: number[] = []
  let closed = false
  const producer = $produce(() => $finally(Effect.gen(function* () {
    yield* $yieldAll(numbers())
  }), Effect.sync(() => { closed = true })))
  expect(Stream.isStream(producer)).toBe(true)
  expect(closed).toBe(false)
  const completion = await Effect.runPromise($forOf(producer, value => Effect.sync(() => {
    events.push(value)
    return value === 2 ? { kind: "break", label: "" } : $normal
  })))
  expect(completion).toEqual($normal)
  expect(events).toEqual([1, 2])
  expect(closed).toBe(true)
})

test("producers: a loop body's other jumps leave the loop as completion records", async () => {
  const outer = { kind: "break", label: "outer" }
  expect(await Effect.runPromise($forOf(numbers(), () => Effect.succeed(outer), "inner"))).toBe(outer)
  const seen: number[] = []
  expect(await Effect.runPromise($forOf(numbers(), value => Effect.sync(() => {
    seen.push(value)
    return { kind: "continue", label: "inner" }
  }), "inner"))).toEqual($normal)
  expect(seen).toEqual([1, 2, 3])
})

test("producers: forOf pulls a Stream and stops at break", async () => {
  expect(await Effect.runPromise(Stream.runCollect(numbers()))).toEqual([1, 2, 3])
  const seen: number[] = []
  await Effect.runPromise($forOf(Stream.make(1, 2, 3), value => Effect.sync(() => {
    seen.push(value)
    return { kind: "break", label: "" }
  })))
  expect(seen).toEqual([1])
})

test("producers: yieldAll yields another producer, a Stream, and an iterable", async () => {
  const all = $produce(() => Effect.gen(function* () {
    yield* $yieldAll(numbers())
    yield* $yieldAll(Stream.make(4, 5))
    yield* $yieldAll([6])
  }))
  expect(await Effect.runPromise(Stream.runCollect(all))).toEqual([1, 2, 3, 4, 5, 6])
})

test("producers: a producer used as a Stream runs at most two elements ahead (VIP-21)", async () => {
  const events: string[] = []
  const counting = $produce(() => Effect.gen(function* () {
    for (let n = 1; n <= 4; n++) {
      events.push(`produce ${n}`)
      yield* $yield(n)
    }
  }))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const pull = yield* Stream.toPull(counting)
    events.push(`pulled ${(yield* pull)[0]}`)
    yield* Effect.sleep("20 millis")
    events.push("waited")
  })))
  // After the first pull, 2 is in the buffer and 3 waits to be offered; 4 never starts.
  expect(events).toEqual(["produce 1", "produce 2", "produce 3", "pulled 1", "waited"])
})

test("producers: a producer's failure fails the Stream that runs it", async () => {
  const failing = $produce(() => Effect.gen(function* () {
    yield* $yield(1)
    return yield* Effect.fail("broken")
  }))
  const exit = await Effect.runPromiseExit(Stream.runCollect(failing))
  expect(exit).toEqual(Exit.fail("broken"))
})

test("boundaries: trusted throws become failures only for instances of the listed classes", () => {
  class Named extends Error {
    override readonly name = "SyntaxError"
  }
  const failure = Effect.runSyncExit($trusted(() => { throw new SyntaxError("bad") }, [SyntaxError]))
  expect(Exit.isFailure(failure) && Cause.hasFails(failure.cause)).toBe(true)
  const defect = Effect.runSyncExit($trusted(() => { throw new TypeError("bad") }, [SyntaxError]))
  expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true)
  const sameName = Effect.runSyncExit($trusted(() => { throw new Named("bad") }, [SyntaxError]))
  expect(Exit.isFailure(sameName) && Cause.hasDies(sameName.cause)).toBe(true)
  expect(Effect.runSync($trusted(() => 42, []))).toBe(42)
})

test("boundaries: in plain code, listed exceptions reach the catch as expected failures", () => {
  const caught = (thunk: () => unknown) => {
    try {
      return $trustedPlain(thunk, [SyntaxError])
    } catch (e) {
      return $caught(e)
    }
  }
  expect(caught(() => 42)).toBe(42)
  expect(caught(() => JSON.parse("{"))).toBeInstanceOf(SyntaxError)
  expect(() => caught(() => { throw new TypeError("bad") })).toThrow(TypeError)
})

test("prelude: exports Effect's modules, pipe, and TaggedError without wrappers", () => {
  class Bad extends TaggedError("Bad")<{}> {}
  expect(new Bad()._tag).toBe("Bad")
  expect(pipe(20, n => n + 22)).toBe(42)
  expect(typeof Schema.String).toBe("function")
  expect(Scope.make).toBeDefined()
  expect(Control).toBeInstanceOf(Function)
  expect(Context.isKey(Settings)).toBe(true)
})

test("adapters: suspend and handoff deliver a synchronous callback result", async () => {
  expect(await Effect.runPromise(suspend<number>(r => { expect(r.resume(42)).toBe(true) }))).toBe(42)
  expect(await Effect.runPromise(handoff<number>(deliver => {
    deliver(42)
    return Effect.void
  }, () => Effect.void))).toBe(42)
})

test("producers: closing a Stream waits for the producer's finalizer", async () => {
  let closed = false
  const producer = $produce(() => $finally(Effect.gen(function* () {
    let n = 0
    while (true) yield* $yield(++n)
  }), Effect.sync(() => { closed = true })))
  expect(await Effect.runPromise(Stream.runCollect(Stream.take(producer, 1)))).toEqual([1])
  expect(closed).toBe(true)
})

test("regions: a failing finalizer retains both original and cleanup failures", () => {
  const exit = Effect.runSyncExit($finally(Effect.fail("body"), Effect.fail("cleanup")))
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const failures = exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)
    expect(failures).toEqual(["body", "cleanup"])
  }
})

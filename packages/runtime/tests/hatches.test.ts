import { describe, expect, test } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber } from "effect"
import { $asyncHatch, $try, callback, sync, type Resume } from "vibelang-runtime"

test("sync is lazy and rerunnable, passes inputs, and leaves returned Effects inert", async () => {
  let runs = 0
  const program = sync((a: number, b: number) => (++runs, a + b), 20, 22)
  expect(runs).toBe(0)
  expect(Effect.runSync(program)).toBe(42)
  expect(Effect.runSync(program)).toBe(42)
  expect(runs).toBe(2)
  const value = Effect.succeed("inert")
  expect(Effect.runSync(sync(() => value))).toBe(value)
  expect(Effect.runSync(sync(42))).toBe(42)
  expect(await Effect.runPromise(sync(Promise.resolve(43)))).toBe(43)
  expect(await Effect.runPromise(sync(async (n: number) => n * 2, 21))).toBe(42)
})

for (const asynchronous of [false, true]) {
  test(`sync ${asynchronous ? "rejection" : "throw"} is a defect`, async () => {
    const error = new Error("foreign failure")
    const evaluate = asynchronous ? async () => { throw error } : () => { throw error }
    expect(await Effect.runPromiseExit(sync(evaluate))).toEqual(Exit.die(error))
  })
}

test("$try, which try e lowers to, returns its Effect unrun", () => {
  const program = Effect.succeed(42)
  expect($try(program)).toBe(program)
})

test("synchronous hatch rest parameters receive exactly the supplied inputs", () => {
  expect(Effect.runSync(sync((...inputs: number[]) => inputs, 1, 2, 3))).toEqual([1, 2, 3])
})

// Called as a value or from TypeScript, sync sees no types, so it decides
// by the function's declaration (D232): an async function that declares a
// parameter after its inputs gets the AbortSignal there; any other function
// gets its inputs only.
for (const [name, hatch] of [["sync", sync]] as const) {
  test(`${name}: an async function receives the AbortSignal after its inputs (D230)`, async () => {
    const value = await Effect.runPromise(hatch(async (input: number, signal: AbortSignal) => ({ input, signal }), 42))
    expect(value.input).toBe(42)
    expect(value.signal).toBeInstanceOf(AbortSignal)
    expect(value.signal.aborted).toBe(false)
    const alone = await Effect.runPromise(hatch(async (signal: AbortSignal) => signal))
    expect(alone).toBeInstanceOf(AbortSignal)
  })

  test(`${name}: interruption aborts an async function's signal`, async () => {
    const events: string[] = []
    await Effect.runPromise(Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const fiber = yield* Effect.forkChild(hatch(async (label: string, signal: AbortSignal) => {
        Deferred.doneUnsafe(started, Effect.void)
        await new Promise<void>(resolve => signal.addEventListener("abort", () => { events.push(`${label} aborted`); resolve() }))
      }, name))
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      const exit = fiber.pollUnsafe()!
      expect(Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true)
    }))
    expect(events).toEqual([`${name} aborted`])
  })

  test(`${name}: an async function with no parameter for the signal gets exactly its inputs`, async () => {
    expect(await Effect.runPromise(hatch(async (...inputs: number[]) => inputs, 1, 2))).toEqual([1, 2])
    expect(await Effect.runPromise(hatch(async (a: number, b: number = 5) => [a, b], 1))).toEqual([1, 5])
    expect(await Effect.runPromise(hatch(async (...inputs: unknown[]) => inputs))).toEqual([])
  })

  test(`${name}: a function that is not async gets exactly its inputs, even when it returns a promise`, async () => {
    expect(await Effect.runPromise(hatch((...inputs: unknown[]) => Promise.resolve(inputs), 1, 2))).toEqual([1, 2])
    const generator = Effect.runSync(hatch(async function*(n: number) { yield n }, 3))
    expect(Object.prototype.toString.call(generator)).toBe("[object AsyncGenerator]")
  })
}

// A direct hatch calls an async function through $asyncHatch: the compiler
// passes signal false when the overload TypeScript chose gives the function
// its inputs alone, and sync called as a value passes true (D232).
test("$asyncHatch gives exactly the inputs, then the signal only when allowed and declared", async () => {
  const optional = async (a: number, b?: unknown) => [a, b]
  expect(await Effect.runPromise(Effect.promise($asyncHatch(optional, false, 1)))).toEqual([1, undefined])
  const [, signal] = await Effect.runPromise(Effect.promise($asyncHatch(optional, true, 1)))
  expect(signal).toBeInstanceOf(AbortSignal)
  const rest = async (...xs: unknown[]) => xs
  expect(await Effect.runPromise(Effect.promise($asyncHatch(rest, true, 1, 2)))).toEqual([1, 2])
  expect(await Effect.runPromise(Effect.promise($asyncHatch(rest, false, 1, 2)))).toEqual([1, 2])
  expect(await Effect.runPromise(Effect.tryPromise({ try: $asyncHatch(rest, false), catch: (error) => error }))).toEqual([])
  const defaulted = async (a: number, b: number = 5) => [a, b]
  expect(await Effect.runPromise(Effect.promise($asyncHatch(defaulted, true, 1)))).toEqual([1, 5])
})

describe("callback", () => {
  test("passes inputs before resume and signal, supports synchronous and delayed completion, and reruns registration", async () => {
    let runs = 0
    const program = callback((a: number, b: number, resume: Resume<number, never>, signal: AbortSignal) => {
      runs++
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
      resume(a + b)
    }, 20, 22)
    expect(runs).toBe(0)
    expect(await Effect.runPromise(program)).toBe(42)
    expect(await Effect.runPromise(program)).toBe(42)
    expect(runs).toBe(2)
    expect(await Effect.runPromise(callback((resume: Resume<number, never>) => {
      queueMicrotask(() => resume(42))
    }))).toBe(42)
  })

  test("fail and exit retain expected failures, defects, and interruption", async () => {
    expect(await Effect.runPromiseExit(callback((resume: Resume<never, string>) => resume.fail("bad")))).toEqual(Exit.fail("bad"))
    for (const exit of [Exit.succeed(42), Exit.fail("bad"), Exit.die("defect"), Exit.interrupt(123)]) {
      expect(await Effect.runPromiseExit(callback((resume: Resume<number, string>) => resume.exit(exit)))).toEqual(exit)
    }
    const defect = new Error("registration failed")
    expect(await Effect.runPromiseExit(callback(() => { throw defect }))).toEqual(Exit.die(defect))
  })

  test("the first completion wins and successful completion does not run cancellation", async () => {
    let canceled = 0
    const value = await Effect.runPromise(callback((resume: Resume<number, string>) => {
      resume(1)
      resume(2)
      resume.fail("late")
      return () => { canceled++ }
    }))
    expect(value).toBe(1)
    expect(canceled).toBe(0)
  })

  test("interruption aborts the signal, runs cancellation once, and ignores late delivery", async () => {
    const events: string[] = []
    let deliver!: Resume<number, never>
    await Effect.runPromise(Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      const child = yield* Effect.forkChild(callback((resume: Resume<number, never>, signal: AbortSignal) => {
        deliver = resume
        signal.addEventListener("abort", () => { events.push("abort") })
        Deferred.doneUnsafe(started, Effect.void)
        return () => events.push("cancel")
      }))
      yield* Deferred.await(started)
      yield* Fiber.interrupt(child)
      const exit = child.pollUnsafe()
      expect(Exit.isFailure(exit!)).toBe(true)
      expect(events).toEqual(["abort", "cancel"])
      deliver(42)
      yield* Fiber.interrupt(child)
      expect(child.pollUnsafe()).toBe(exit)
      expect(events).toEqual(["abort", "cancel"])
    }))
  })

  test("a cancellation defect is retained alongside interruption", async () => {
    const defect = new Error("cancel failed")
    await Effect.runPromise(Effect.gen(function*() {
      const child = yield* Effect.forkChild(callback(() => () => { throw defect }), { startImmediately: true })
      yield* Fiber.interrupt(child)
      const exit = child.pollUnsafe()!
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true)
        expect(exit.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect)
      }
    }))
  })
})

// S19-30: asynchronous cancellation must finish before Fiber.interrupt returns.
for (const kind of ["promise", "thenable", "callable thenable", "effect"] as const) {
  test(`callback awaits ${kind} cancellation after abort, once`, async () => {
    const events: string[] = []
    let signal!: AbortSignal
    const finish = () => { events.push("cleanup finished") }
    const program = callback((_resume: Resume<never, never>, abort: AbortSignal) => {
      signal = abort
      const pending = () => new Promise<void>(resolve => setTimeout(() => { finish(); resolve() }, 10))
      if (kind === "effect") return Effect.promise(pending)
      if (kind === "thenable") return () => { const p = pending(); return { then: p.then.bind(p) } }
      if (kind === "callable thenable") return () => { const p = pending(); return Object.assign(() => {}, { then: p.then.bind(p) }) }
      return () => pending()
    })
    await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(program, { startImmediately: true })
      signal.addEventListener("abort", () => { events.push("abort") })
      yield* Fiber.interrupt(fiber)
      events.push("interrupt returned")
      yield* Fiber.interrupt(fiber)
    }))
    expect(events).toEqual(["abort", "cleanup finished", "interrupt returned"])
  })
}

for (const kind of ["promise", "effect"] as const) {
  test(`callback skips ${kind} cleanup after synchronous resume`, async () => {
    let cleaned = false
    const cleanup = () => { cleaned = true }
    const value = await Effect.runPromise(callback((resume: Resume<number, never>) => {
      resume(42)
      return kind === "effect" ? Effect.sync(cleanup) : async () => { cleanup() }
    }))
    expect(value).toBe(42)
    expect(cleaned).toBe(false)
  })

  test(`callback retains ${kind} cleanup defects alongside interruption`, async () => {
    const defect = new Error("cleanup failed")
    await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(callback(() => kind === "effect"
        ? Effect.die(defect)
        : () => Promise.reject(defect)), { startImmediately: true })
      yield* Fiber.interrupt(fiber)
      const exit = fiber.pollUnsafe()!
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true)
        expect(exit.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect)
      }
    }))
  })
}

test("callback's returned Effect finalizer retains its service requirements", async () => {
  class Cleanup extends Context.Service<Cleanup, { readonly finish: () => void }>()("hatches/Cleanup") {}
  let cleaned = 0
  const program: Effect.Effect<number, never, Cleanup> = callback((_resume: Resume<number, never>) =>
    Effect.flatMap(Cleanup, service => Effect.sync(service.finish)))
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(program, { startImmediately: true })
    yield* Fiber.interrupt(fiber)
  }).pipe(Effect.provideService(Cleanup, { finish: () => { cleaned++ } })))
  expect(cleaned).toBe(1)
})

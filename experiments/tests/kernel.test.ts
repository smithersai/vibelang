// Laws of the continuation kernel, tested directly against effect@4.1.0.
import { describe, expect, test } from "bun:test"
import { Cause, Context, Effect, Exit, Fiber, Scope } from "effect"
import {
  abandon,
  type Continuation,
  handle,
  HandlerNotOnThisFiber,
  operation,
  provideInPlace,
  resume,
  resumeWith,
  suspend,
  Suspended,
  transfer
} from "../../packages/runtime/src/kernel/kernel.ts"
import { compiled } from "../../packages/runtime/src/kernel/trace.ts"

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromiseExit(effect)

const defectTag = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return undefined
  const die = exit.cause.reasons.find(Cause.isDieReason)
  return (die?.defect as any)?._tag
}

const recorder = () => {
  const events: Array<string> = []
  return { events, note: (line: string) => Effect.sync(() => void events.push(line)) }
}

describe("one-shot ownership", () => {
  test("T2 a second resume is a defect at the resume site", async () => {
    const Ask = operation<void, number>("Ask")
    const program = handle("h", [Ask], Ask(undefined), {
      Ask: (_: void, k: Continuation) =>
        Effect.gen(function*() {
          const first = yield* resume(k, 1)
          const second = yield* resume(k, 2)
          return [first, second]
        })
    })
    const exit = await run(program)
    expect(defectTag(exit)).toBe("ContinuationAlreadyConsumed")
  })

  test("T3 a clause that returns without resuming abandons the continuation first", async () => {
    const Ask = operation<void, number>("Ask")
    const { events, note } = recorder()
    const body = Effect.scoped(Effect.gen(function*() {
      yield* Effect.acquireRelease(note("acquire"), () => note("release"))
      yield* Effect.addFinalizer((exit) => note(`finalizer sees interrupt=${Exit.hasInterrupts(exit)}`))
      const n = yield* Ask(undefined).pipe(
        Effect.catchCause(() => Effect.as(note("catchCause ran (must not)"), -1))
      )
      yield* note(`never reached ${n}`)
      return n
    }))
    const program = Effect.gen(function*() {
      const result = yield* handle("h", [Ask], body, {
        Ask: () => Effect.as(note("clause returns without resuming"), -100)
      })
      yield* note(`handle returned ${result}`)
      return result
    })
    const exit = await run(program)
    expect(Exit.isSuccess(exit) && exit.value).toBe(-100)
    expect(events).toEqual([
      "acquire",
      "clause returns without resuming",
      "finalizer sees interrupt=true",
      "release",
      "handle returned -100"
    ])
  })

  test("T4 interruption while a continuation is captured unwinds clause, then continuation, then outer", async () => {
    const Ask = operation<void, number>("Ask")
    const { events, note } = recorder()
    const body = Effect.scoped(Effect.gen(function*() {
      yield* Effect.addFinalizer(() => note("continuation finalizer"))
      return yield* Ask(undefined)
    }))
    const program = handle("h", [Ask], body, {
      Ask: () => Effect.ensuring(Effect.andThen(note("clause waiting"), Effect.never), note("clause finalizer"))
    }).pipe(Effect.ensuring(note("outer finalizer")))
    const exit = await run(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(program)
      yield* Effect.sleep("5 millis")
      yield* Fiber.interrupt(fiber)
      return yield* Fiber.await(fiber)
    }))
    expect(Exit.isSuccess(exit) && Exit.hasInterrupts(exit.value)).toBe(true)
    expect(events).toEqual(["clause waiting", "clause finalizer", "continuation finalizer", "outer finalizer"])
  })

  test("T5a Effect.callback silently drops a resume that arrives after interruption", async () => {
    let lateResume: ((effect: Effect.Effect<string>) => void) | undefined
    const { events, note } = recorder()
    const waiter = Effect.callback<string>((resume) => {
      lateResume = resume
      return note("callback cleanup ran")
    })
    const exit = await run(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(waiter)
      yield* Effect.sleep("1 millis")
      yield* Fiber.interrupt(fiber)
      // The producer now hands over a resource. Nothing tells it the waiter is gone.
      lateResume!(Effect.succeed("connection-1"))
      yield* note("late resume returned without any signal")
      return yield* Fiber.await(fiber)
    }))
    expect(Exit.isSuccess(exit) && Exit.hasInterrupts(exit.value)).toBe(true)
    expect(events).toEqual(["callback cleanup ran", "late resume returned without any signal"])
  })

  test("T5b the kernel's suspend reports the lost race so the producer can release the value", async () => {
    let resumer: { resume: (v: string) => boolean } | undefined
    const { events, note } = recorder()
    const waiter = suspend<string>((r) => {
      resumer = r
      return () => events.push("registration cleanup ran")
    })
    const exit = await run(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(waiter)
      yield* Effect.sleep("1 millis")
      yield* Fiber.interrupt(fiber)
      const delivered = resumer!.resume("connection-1")
      yield* note(delivered ? "delivered" : "not delivered: producer releases connection-1")
      return yield* Fiber.await(fiber)
    }))
    expect(Exit.isSuccess(exit) && Exit.hasInterrupts(exit.value)).toBe(true)
    expect(events).toEqual(["registration cleanup ran", "not delivered: producer releases connection-1"])
  })

  test("T5c a resume that wins the race delivers once; a second resume reports false", async () => {
    let resumer: { resume: (v: string) => boolean } | undefined
    const exit = await run(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(suspend<string>((r) => void (resumer = r)))
      yield* Effect.sleep("1 millis")
      const first = resumer!.resume("a")
      const second = resumer!.resume("b")
      const value = yield* Fiber.join(fiber)
      return { first, second, value }
    }))
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ first: true, second: false, value: "a" })
  })
})

describe("handler semantics", () => {
  test("T9 deep handler: one clause per perform; resume returns the rest of the computation", async () => {
    const Emit = operation<number, void>("Emit")
    const body = Effect.gen(function*() {
      for (let i = 1; i <= 3; i++) yield* Emit(i)
      yield* Effect.sleep("1 millis") // root-level suspension after resumptions
      return "done"
    })
    const program = handle(
      "collect",
      [Emit],
      body,
      { Emit: (n: number, k: Continuation) => Effect.map(resume(k, undefined), (rest: Array<unknown>) => [n, ...rest]) },
      (value) => Effect.succeed([value])
    )
    const exit = await run(program)
    expect(Exit.isSuccess(exit) && exit.value).toEqual([1, 2, 3, "done"])
  })

  test("a clause runs outside its own handler: performing the same operation reaches the outer handler", async () => {
    const Ask = operation<string, string>("Ask")
    const inner = handle("inner", [Ask], Ask("question"), {
      Ask: (q: string, k: Continuation) => Effect.flatMap(Ask(`outer, please answer ${q}`), (a) => resume(k, `inner(${a})`))
    })
    const program = handle("outer", [Ask], inner, {
      Ask: (q: string, k: Continuation) => resume(k, `outer saw "${q}"`)
    })
    const exit = await run(program)
    expect(Exit.isSuccess(exit) && exit.value).toBe(`inner(outer saw "outer, please answer question")`)
  })

  test("resumeWith delivers a typed failure at the perform site, where the body may recover", async () => {
    const Ask = operation<void, number>("Ask")
    const body = Effect.catchTag(
      Ask(undefined) as Effect.Effect<number, { readonly _tag: "Busy" }>,
      "Busy",
      () => Effect.succeed(-1)
    )
    const program = handle("h", [Ask], body, {
      Ask: (_: void, k: Continuation) => resumeWith(k, Effect.fail({ _tag: "Busy" as const }))
    })
    const exit = await run(program)
    expect(Exit.isSuccess(exit) && exit.value).toBe(-1)
  })

  test("in-place evidence runs in the caller's Context (Effect service semantics)", async () => {
    class Tenant extends Context.Service<Tenant, string>()("app/Tenant") {}
    const Lookup = operation<string, string>("Lookup")
    const program = Effect.gen(function*() {
      const a = yield* Lookup("x").pipe(Effect.provideService(Tenant, "acme"))
      const b = yield* Lookup("x").pipe(Effect.provideService(Tenant, "globex"))
      return [a, b]
    }).pipe(provideInPlace(Lookup, (key: string) => Effect.map(Effect.service(Tenant), (t) => `${t}:${key}`)))
    const exit = await run(program as Effect.Effect<Array<string>>)
    expect(Exit.isSuccess(exit) && exit.value).toEqual(["acme:x", "globex:x"])
  })

  test("a prompt handler overrides in-place evidence for its region only", async () => {
    const Lookup = operation<string, string>("Lookup")
    const program = Effect.gen(function*() {
      const outside = yield* Lookup("a")
      const inside = yield* handle("override", [Lookup], Lookup("b"), {
        Lookup: (key: string, k: Continuation) => resume(k, `fake:${key}`)
      })
      const after = yield* Lookup("c")
      return [outside, inside, after]
    }).pipe(provideInPlace(Lookup, (key: string) => Effect.succeed(`real:${key}`)))
    const exit = await run(program as Effect.Effect<Array<string>>)
    expect(Exit.isSuccess(exit) && exit.value).toEqual(["real:a", "fake:b", "real:c"])
  })
})

describe("interop with TypeScript-authored Effect code", () => {
  test("T7a capture passes through Effect.forEach running on the same fiber", async () => {
    const Ask = operation<number, number>("Ask")
    const program = handle("h", [Ask], Effect.forEach([1, 2, 3], (i) => Ask(i)), {
      Ask: (i: number, k: Continuation) => resume(k, i * 10)
    })
    const exit = await run(program)
    expect(Exit.isSuccess(exit) && exit.value).toEqual([10, 20, 30])
  })

  test("T7b combinators that fork (timeout, concurrent all) cannot reach a prompt on the parent fiber", async () => {
    const Ask = operation<number, number>("Ask")
    const clauses = { Ask: (i: number, k: Continuation) => resume(k, i) }
    const viaTimeout = await run(handle("h", [Ask], Effect.timeout(Ask(1), "1 second"), clauses))
    const viaAll = await run(
      handle("h", [Ask], Effect.all([Ask(1), Ask(2)], { concurrency: "unbounded" }), clauses)
    )
    expect(defectTag(viaTimeout)).toBe("HandlerNotOnThisFiber")
    expect(defectTag(viaAll)).toBe("HandlerNotOnThisFiber")
  })

  test("T8 a forked child does not inherit control handlers, only Context", async () => {
    const Ask = operation<void, number>("Ask")
    const body = Effect.gen(function*() {
      const child = yield* Effect.forkChild(Ask(undefined))
      return yield* Fiber.join(child)
    })
    const exit = await run(handle("h", [Ask], body, { Ask: (_: void, k: Continuation) => resume(k, 1) }))
    expect(defectTag(exit)).toBe("HandlerNotOnThisFiber")
    expect(new HandlerNotOnThisFiber("Ask").message).toContain("do not cross fork boundaries")
  })
})

describe("stack safety and cost", () => {
  const depth = 100_000

  test("T6a 100000 nested compiled calls; the innermost performs and all 100001 frames are captured", async () => {
    const Ask = operation<void, number>("Ask")
    let captured = 0
    const descend: (n: number) => Effect.Effect<number> = compiled("descend", function*(n: number) {
      if (n === 0) return yield* Ask(undefined)
      const below: number = yield* descend(n - 1)
      return below + 1
    })
    const program = handle("h", [Ask], descend(depth), {
      Ask: (_: void, k: Continuation) => {
        captured = k.frameCount
        return resume(k, 0)
      }
    })
    const exit = await run(program)
    expect(Exit.isSuccess(exit) && exit.value).toBe(depth)
    // Levels depth..0 are depth + 1 compiled frames, all captured by the innermost perform.
    expect(captured).toBe(depth + 1)
  })

  test("T6b the same recursion as plain JavaScript overflows the host stack", () => {
    const direct = (n: number): number => (n === 0 ? 0 : direct(n - 1) + 1)
    let outcome = "ok"
    try {
      direct(depth * 10)
    } catch (error) {
      outcome = (error as Error).constructor.name
    }
    expect(outcome).toBe("RangeError")
  })
})

describe("generators derived from one-shot continuations", () => {
  test("T10 external iteration: take 3 from an infinite producer; closing the scope abandons it", async () => {
    const Yield = operation<number, void>("Yield")
    const { events, note } = recorder()
    const producer = Effect.scoped(Effect.gen(function*() {
      yield* Effect.addFinalizer(() => note("producer finalizer"))
      for (let i = 0;; i++) yield* Yield(i)
    }))
    type Step = { readonly done: true } | { readonly done: false; readonly value: number; readonly next: Suspended }
    // The clause transfers k to the Scope around the handler (the consumer's
    // scoped region) and returns the first-class Suspended handle.
    const start: Effect.Effect<Step> = handle("generator", [Yield], producer, {
      Yield: (value: number, k: Continuation) => Effect.map(transfer(k), (next) => ({ done: false, value, next }))
    }, () => Effect.succeed({ done: true }))
    const take = (n: number) =>
      Effect.scoped(Effect.gen(function*() {
        const values: Array<number> = []
        let step: Step = yield* start
        while (!step.done && values.length < n) {
          values.push(step.value)
          if (values.length < n) step = (yield* resume(step.next, undefined)) as Step
        }
        yield* note(`took ${values.join(",")}`)
        return values
      }))
    const exit = await run(take(3))
    expect(Exit.isSuccess(exit) && exit.value).toEqual([0, 1, 2])
    expect(events).toEqual(["took 0,1,2", "producer finalizer"])
  })
})

describe("cold programs versus live continuations", () => {
  test("T11 retry re-runs the cold program; each attempt captures a fresh continuation", async () => {
    const Ask = operation<void, number>("Ask")
    const seen: Array<Continuation> = []
    let attempts = 0
    const body = Effect.gen(function*() {
      attempts++
      const n = yield* Ask(undefined)
      if (attempts === 1) return yield* Effect.fail("first attempt fails" as const)
      return n
    })
    const program = handle("h", [Ask], body, {
      Ask: (_: void, k: Continuation) =>
        Effect.gen(function*() {
          seen.push(k)
          if (seen.length === 2) {
            // Reusing attempt 1's continuation is impossible: it was consumed.
            const stale = yield* Effect.exit(resume(seen[0]!, 99))
            expect(Exit.isFailure(stale)).toBe(true)
          }
          return yield* resume(k, attempts * 10)
        })
    })
    const exit = await run(Effect.retry(program, { times: 1 }))
    expect(Exit.isSuccess(exit) && exit.value).toBe(20)
    expect(seen.length).toBe(2)
    expect(seen[0]!.id).not.toBe(seen[1]!.id)
    expect(seen.map((k) => k.state)).toEqual(["resumed", "resumed"])
  })

  test("abandoning an already-resumed continuation is a no-op, not a second unwinding", async () => {
    const Ask = operation<void, number>("Ask")
    const { events, note } = recorder()
    let saved: Continuation | undefined
    const body = Effect.ensuring(Ask(undefined), note("body finalizer"))
    const program = Effect.gen(function*() {
      const value = yield* handle("h", [Ask], body, {
        Ask: (_: void, k: Continuation) => {
          saved = k
          return resume(k, 7)
        }
      })
      yield* abandon(saved!)
      return value
    })
    const exit = await run(program)
    expect(Exit.isSuccess(exit) && exit.value).toBe(7)
    expect(events).toEqual(["body finalizer"])
  })
})

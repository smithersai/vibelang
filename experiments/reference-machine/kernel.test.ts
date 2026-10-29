import { describe, expect, test } from "bun:test"
import { Cause, Context, Effect, Exit, Fiber } from "effect"
import {
  abandon, bind, call, catching, Continuation, ContinuationUseError, die, discontinue,
  fail, fork, handle, handoff, join, lift, masked, perform, Program, provide, pure,
  resume, run, scoped, Trace
} from "./kernel"

class Service extends Context.Service<Service, string>()("kernel/Service") {}
const action = (f: () => void) => lift(Effect.sync(f))
const resource = (events: string[], name: string) => lift(Effect.acquireRelease(
  Effect.sync(() => { events.push(`open:${name}`); return name }),
  () => Effect.sync(() => { events.push(`close:${name}`) })
))
const execute = <A>(p: Program<A>, trace?: Trace[]) => Effect.runPromise(run(p, trace) as Effect.Effect<A, any>)
const deferred = <A>() => {
  let resolve!: (a: A) => void
  const promise = new Promise<A>((r) => { resolve = r })
  return { promise, resolve }
}

describe("required continuation experiments", () => {
  test("(i) outer handler, nested calls, inner service after resume, outer clause context, same fiber", async () => {
    const observations: string[] = []
    const fibers: number[] = []
    const identify = lift(Effect.withFiber((f) => Effect.sync(() => { fibers.push(f.id) })))
    const nested = call(() => call(() => bind(identify, () => bind(perform<number>("ask"), (n) =>
      bind(lift(Service), (s) => bind(identify, () => pure(`${s}:${n}`)))
    ))))
    const p = provide(handle(provide(nested, Service, "inner"), {
      ask: (_, k) => bind(lift(Service), (s) => bind(action(() => observations.push(s)), () =>
        bind(identify, () => resume(k, 42))))
    }), Service, "outer")
    expect(await execute(p)).toBe("inner:42")
    expect(observations).toEqual(["outer"])
    expect(new Set(fibers).size).toBe(1)
  })

  test("(ii) scope stays open across capture and closes exactly once", async () => {
    const events: string[] = []
    const p = handle(scoped(bind(resource(events, "region"), () => bind(perform("pause"), () =>
      bind(action(() => events.push("resumed")), () => pure(7))))), {
      pause: (_, k) => bind(action(() => {
        expect(events).toEqual(["open:region"])
        events.push("clause")
      }), () => resume(k, undefined))
    })
    expect(await execute(p)).toBe(7)
    expect(events).toEqual(["open:region", "clause", "resumed", "close:region"])
  })

  test("(iii) double resume rejected as a defect", async () => {
    const p = handle(perform("pause"), { pause: (_, k) => bind(resume(k, 1), () => resume(k, 2)) })
    const result = await Effect.runPromiseExit(run(p) as Effect.Effect<any, any>)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(result.cause.reasons.some((r) => r._tag === "Die" && r.defect instanceof ContinuationUseError)).toBe(true)
    }
  })

  test("(iv) abandonment finalizes before handle returns and revokes escape", async () => {
    const events: string[] = []
    let escaped!: Continuation
    const p = bind(handle(scoped(bind(resource(events, "abandoned"), () => perform("stop"))), {
      stop: (_, k) => { escaped = k; return pure("short") }
    }), (result) => bind(action(() => events.push(`returned:${result}`)), () => pure(result)))
    expect(await execute(p)).toBe("short")
    expect(events).toEqual(["open:abandoned", "close:abandoned", "returned:short"])
    expect(escaped.state).toBe("Abandoned")
    const result = await Effect.runPromiseExit(run(resume(escaped, 1)) as Effect.Effect<any, any>)
    expect(Exit.isFailure(result)).toBe(true)
  })

  test("(v) interrupt while captured: clause scope, captured scope, outer scope", async () => {
    const events: string[] = []
    const waiting = deferred<void>()
    const trace: Trace[] = []
    let captured!: Continuation
    const p = scoped(bind(resource(events, "outer"), () => handle(
      scoped(bind(resource(events, "captured"), () => perform("pause"))), {
        pause: (_, k) => {
          captured = k
          return scoped(bind(resource(events, "clause"), () => lift(Effect.callback<void>(() => {
            waiting.resolve()
            return Effect.sync(() => events.push("cancel:wait"))
          }))))
        }
      }
    )))
    const fiber = Effect.runFork(run(p, trace) as Effect.Effect<any, any>)
    await waiting.promise
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(events).toEqual([
      "open:outer", "open:captured", "open:clause", "cancel:wait",
      "close:clause", "close:captured", "close:outer"
    ])
    expect(captured.state).toBe("Canceled")
    expect(trace.some((x) => x.event === "continuation:Canceled")).toBe(true)
    expect(Exit.isFailure(fiber.pollUnsafe()!)).toBe(true)
  })

  test("(vi) cancellation wins: late resource released before cancel-and-join completes", async () => {
    const events: string[] = []
    const ready = deferred<void>()
    const cancelStarted = deferred<void>()
    const producerDone = deferred<void>()
    let deliver!: (value: string) => void
    let captured!: Continuation
    const acquire = handoff<string>((put) => {
      deliver = put
      ready.resolve()
      return Effect.flatMap(Effect.sync(() => {
        events.push("cancel:producer")
        cancelStarted.resolve()
      }), () => Effect.promise(() => producerDone.promise))
    }, (r) => Effect.sync(() => events.push(`release:${r}`)))
    const p = handle(scoped(bind(resource(events, "captured"), () =>
      bind(perform<string>("acquire"), () => action(() => events.push("used"))))), {
      acquire: (_, k) => {
        captured = k
        return scoped(bind(lift(Effect.acquireRelease(acquire,
          (r) => Effect.sync(() => events.push(`release:${r}`)), { interruptible: true }
        )), (r) => resume(k, r)))
      }
    })
    const fiber = Effect.runFork(run(p) as Effect.Effect<any, any>)
    await ready.promise
    const cancellation = Effect.runPromise(Fiber.interrupt(fiber))
    await cancelStarted.promise
    deliver("late")
    events.push("delivered:late")
    producerDone.resolve()
    await cancellation
    expect(events).toEqual(["open:captured", "cancel:producer", "delivered:late", "release:late", "close:captured"])
    expect(captured.state).toBe("Canceled")
  })

  test("(vi, opposite winner) delivery wins: normal scope releases once", async () => {
    const events: string[] = []
    const acquire = handoff<string>((deliver) => {
      deliver("early")
      return Effect.void
    }, (r) => Effect.sync(() => events.push(`late:${r}`)))
    let captured!: Continuation
    const p = handle(bind(perform<string>("acquire"), (r) => action(() => events.push(`used:${r}`))), {
      acquire: (_, k) => {
        captured = k
        return scoped(bind(lift(Effect.acquireRelease(acquire,
          (r) => Effect.sync(() => events.push(`release:${r}`)), { interruptible: true }
        )), (r) => resume(k, r)))
      }
    })
    await execute(p)
    expect(events).toEqual(["used:early", "release:early"])
    expect(captured.state).toBe("Completed")
  })

  test("(vii) 100000 nested resumable calls are stack safe and scheduler yields", async () => {
    const depth = 100000
    let calls = 0
    let captures = 0
    let timerRan = false
    setTimeout(() => { timerRan = true }, 0)
    const descend = (n: number): Program<number> => call(() => {
      calls++
      return n === 0 ? perform<number>("tick", n) : bind(descend(n - 1), (v) =>
        bind(perform<number>("tick", n), () => pure(v + 1)))
    })
    const p = handle(descend(depth), {
      tick: (_, k) => { captures++; return resume(k, 0) }
    })
    expect(await execute(p)).toBe(depth)
    expect(calls).toBe(depth + 1)
    expect(captures).toBe(depth + 1)
    expect(timerRan).toBe(true)
  }, 30000)
})

describe("additional semantic probes", () => {
  test("deep handler reinstalls itself after resume", async () => {
    let calls = 0
    const p = handle(bind(perform<number>("ask"), (a) => bind(perform<number>("ask"), (b) => pure(a + b))), {
      ask: (_, k) => { calls++; return resume(k, calls) }
    })
    expect(await execute(p)).toBe(3)
    expect(calls).toBe(2)
  })

  test("typed failure, defect and discontinue take distinct paths", async () => {
    expect(await execute(catching(fail("expected"), (e) => pure(`caught:${e}`)))).toBe("caught:expected")
    const defect = await Effect.runPromiseExit(run(catching(die("bug"), () => pure("wrong"))) as Effect.Effect<any, any>)
    expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true)
    expect(await execute(handle(catching(perform("ask"), (e) => pure(`injected:${e}`)), {
      ask: (_, k) => discontinue(k, "no")
    }))).toBe("injected:no")
  })

  test("failure closes nested scopes in LIFO order", async () => {
    const events: string[] = []
    const p = scoped(bind(resource(events, "outer"), () => scoped(bind(resource(events, "inner"), () => fail("bad")))))
    const result = await Effect.runPromiseExit(run(p) as Effect.Effect<any, any>)
    expect(Exit.isFailure(result) && Cause.hasFails(result.cause)).toBe(true)
    expect(events).toEqual(["open:outer", "open:inner", "close:inner", "close:outer"])
  })

  test("explicit abandonment is terminal", async () => {
    let captured!: Continuation
    const events: string[] = []
    await execute(handle(scoped(bind(resource(events, "r"), () => perform("stop"))), {
      stop: (_, k) => { captured = k; return abandon(k) }
    }))
    expect(captured.state).toBe("Abandoned")
    expect(events).toEqual(["open:r", "close:r"])
  })

  test("failed owner cancels its detached continuation before an outer catch", async () => {
    const events: string[] = []
    let captured!: Continuation
    const p = catching(handle(scoped(bind(resource(events, "parked"), () => perform("stop"))), {
      stop: (_, k) => { captured = k; return fail("clause-error") }
    }), (e) => bind(action(() => events.push(`caught:${e}`)), () => pure("recovered")))
    expect(await execute(p)).toBe("recovered")
    expect(captured.state).toBe("Canceled")
    expect(events).toEqual(["open:parked", "close:parked", "caught:clause-error"])
  })

  test("structured fork: fresh handler root, inherited service, join", async () => {
    const p = provide(bind(fork(handle(bind(lift(Service), (s) => bind(perform("q"), () => pure(s))), {
      q: (_, k) => resume(k, 0)
    })), (f) => join(f)), Service, "inherited")
    expect(await execute(p)).toBe("inherited")
    const missing = await Effect.runPromiseExit(run(handle(bind(fork(perform("q")), (f) => join(f)), {
      q: (_, k) => resume(k, 0)
    })) as Effect.Effect<any, any>)
    expect(Exit.isFailure(missing) && Cause.hasDies(missing.cause)).toBe(true)
  })

  test("parent scope waits for child finalization before releasing parent resources", async () => {
    const events: string[] = []
    const ready = deferred<void>()
    const child = scoped(bind(resource(events, "child"), () => lift(Effect.callback<void>(() => { ready.resolve() }))))
    const p = scoped(bind(resource(events, "parent"), () => bind(fork(child), () => lift(Effect.promise(() => ready.promise)))))
    await execute(p)
    expect(events).toEqual(["open:parent", "open:child", "close:child", "close:parent"])
  })

  test("masked async region defers interruption until it exits", async () => {
    const ready = deferred<void>()
    const events: string[] = []
    let release!: () => void
    const p = scoped(bind(resource(events, "mask"), () => masked(bind(lift(Effect.callback<void>((resumeEffect) => {
      release = () => resumeEffect(Effect.void)
      ready.resolve()
    })), () => action(() => events.push("inside:mask"))))))
    const fiber = Effect.runFork(run(p) as Effect.Effect<any, any>)
    await ready.promise
    fiber.interruptUnsafe()
    expect(fiber.pollUnsafe()).toBeUndefined()
    release()
    await Effect.runPromise(Fiber.await(fiber))
    expect(events).toEqual(["open:mask", "inside:mask", "close:mask"])
    expect(Exit.isFailure(fiber.pollUnsafe()!)).toBe(true)
  })

  test("unmask observes pending interruption before invoking the next call", async () => {
    const ready = deferred<void>()
    let release!: () => void
    const events: string[] = []
    const p = bind(masked(lift(Effect.callback<void>((resumeEffect) => {
      release = () => resumeEffect(Effect.void)
      ready.resolve()
    }))), () => call(() => { events.push("after:mask"); return pure(1) }))
    const fiber = Effect.runFork(run(p) as Effect.Effect<any, any>)
    await ready.promise
    fiber.interruptUnsafe()
    release()
    await Effect.runPromise(Fiber.await(fiber))
    expect(events).toEqual([])
    expect(Exit.isFailure(fiber.pollUnsafe()!)).toBe(true)
  })

  test("finalizer defects preserve failure and do not skip outer cleanup", async () => {
    const events: string[] = []
    const badResource = lift(Effect.acquireRelease(Effect.succeed(1), () =>
      Effect.flatMap(Effect.sync(() => events.push("close:bad")), () => Effect.die("release-bug"))))
    const p = scoped(bind(resource(events, "outer"), () => scoped(bind(badResource, () => fail("body-error")))))
    const result = await Effect.runPromiseExit(run(p) as Effect.Effect<any, any>)
    expect(Exit.isFailure(result) && Cause.hasFails(result.cause) && Cause.hasDies(result.cause)).toBe(true)
    expect(events).toEqual(["open:outer", "close:bad", "close:outer"])
  })
})

describe("Effect 4.1.0 behavior probes (not language-continuation tests)", () => {
  test("Effect.gen drops JavaScript finally on typed failure", async () => {
    const events: string[] = []
    const p = Effect.gen(function*() {
      try { yield* Effect.fail("bad") }
      finally { events.push("JS-finally") }
    })
    const result = await Effect.runPromiseExit(p)
    expect(Exit.isFailure(result)).toBe(true)
    expect(events).toEqual([])
  })

  test("Effect.callback silently ignores late resumes, including their effects", async () => {
    const events: string[] = []
    let callback!: (e: Effect.Effect<number>) => void
    const ready = deferred<void>()
    const fiber = Effect.runFork(Effect.callback<number>((r) => { callback = r; ready.resolve() }))
    await ready.promise
    await Effect.runPromise(Fiber.interrupt(fiber))
    callback(Effect.sync(() => { events.push("late-effect"); return 1 }))
    expect(events).toEqual([])
  })
})

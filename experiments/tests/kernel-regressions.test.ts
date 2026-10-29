// Regressions for the kernel defects the 2026-10-16 reviews found
// One block per fix;
// experiments/KERNEL-CHANGES.md states the law each block checks.
import { afterEach, describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Scope } from "effect"
import {
  abandon,
  abandonNow,
  catchExpected,
  type Continuation,
  handle,
  hooks,
  operation,
  type Resumer,
  resume,
  suspend,
  type Suspended,
  tailResume,
  tailResumeWith,
  transfer,
  wakeConfig
} from "../../packages/runtime/src/kernel/kernel.ts"

afterEach(() => {
  hooks.onCapture = undefined
  hooks.onResume = undefined
})

const recorder = () => {
  const events: Array<string> = []
  return { events, note: (line: string) => Effect.sync(() => void events.push(line)) }
}

const defects = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isDieReason).map((r) => (r.defect as any)?._tag ?? r.defect) : []

const interrupts = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isInterruptReason).map((r) => r.fiberId) : []

const fails = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isFailReason).map((r) => r.error) : []

// Records the deepest fiber stack seen at any resume.
const deepestResume = () => {
  const seen = { max: 0 }
  hooks.onResume = (fiber) => {
    seen.max = Math.max(seen.max, fiber._stack.length)
  }
  return seen
}

describe("K11 tail resume from a compiled (generator) clause", () => {
  const Yield = operation<number, void>("K11Yield")
  const counter = (n: number) =>
    Effect.gen(function*() {
      for (let i = 0; i < n; i++) yield* Yield(i)
    })

  test("K11a T17 with an Effect.fnUntraced clause: `return tailResume(k, v)` iterates 100,000 elements in constant stack", async () => {
    const N = 100_000
    let sum = 0
    // Generated for: for (const n of counter(N)) sum += n
    const clause = Effect.fnUntraced(function*(n: number, k: Continuation) {
      sum += n
      return tailResume(k, undefined)
    })
    const depth = deepestResume()
    const exit = await Effect.runPromiseExit(handle("for-of", [Yield], Effect.asVoid(counter(N)), { K11Yield: clause }))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(sum).toBe((N * (N - 1)) / 2)
    expect(depth.max).toBeLessThan(20)

    // Contrast, the shape the reviews measured: yielding the resume keeps the
    // clause's Iterator, Clause and Owner frames alive for every element.
    const yielding = Effect.fnUntraced(function*(_n: number, k: Continuation) {
      return yield* resume(k, undefined)
    })
    const grows = deepestResume()
    await Effect.runPromise(handle("for-of", [Yield], Effect.asVoid(counter(1000)), { K11Yield: yielding }))
    expect(grows.max).toBeGreaterThan(1000)
  })

  test("K11b per-element using and finally close before the tail resume; stack stays constant; break abandons the producer", async () => {
    // Source:
    //   function* naturals() { using _ = span("naturals"); for (let i = 0;; i++) yield i }
    //   for (const n of naturals()) {
    //     using lease = Leases.acquire(n)
    //     try { if (n === LIMIT) break; sum += n } finally { finallies++ }
    //   }
    const LIMIT = 100_000
    const { events, note } = recorder()
    const counts = { acquired: 0, released: 0, finallies: 0 }
    const trace = (n: number, line: string) => (n < 2 || n === LIMIT ? note(`${line} ${n}`) : Effect.void)
    const lease = (n: number) =>
      Effect.acquireRelease(
        Effect.andThen(trace(n, "acquire"), Effect.sync(() => void counts.acquired++)),
        () => Effect.andThen(trace(n, "release"), Effect.sync(() => void counts.released++))
      )
    const naturals = Effect.scoped(Effect.gen(function*() {
      yield* Effect.addFinalizer(() => note("producer finalizer"))
      for (let i = 0;; i++) yield* Yield(i)
    }))
    type Completion = { readonly kind: "normal" } | { readonly kind: "break" }
    let sum = 0
    // Generated clause: the loop body is a Scope region (it has `using`)
    // around a try/finally region; each region returns a completion record,
    // and the clause dispatches on it after every region has closed.
    const clause = Effect.fnUntraced(function*(n: number, k: Continuation) {
      const completion: Completion = yield* Effect.scoped(Effect.fnUntraced(function*() {
        yield* lease(n)
        return yield* Effect.ensuring(
          Effect.fnUntraced(function*() {
            if (n === LIMIT) return { kind: "break" } as const
            sum += n
            return { kind: "normal" } as const
          })(),
          Effect.andThen(trace(n, "finally"), Effect.sync(() => void counts.finallies++))
        )
      })())
      if (completion.kind === "break") return // k stays suspended: its Owner abandons the producer
      return tailResume(k, undefined)
    })
    const depth = deepestResume()
    const exit = await Effect.runPromiseExit(Effect.andThen(
      handle("for-of", [Yield], Effect.asVoid(naturals), { K11Yield: clause }),
      note("loop exited")
    ))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(sum).toBe((LIMIT * (LIMIT - 1)) / 2)
    expect(counts).toEqual({ acquired: LIMIT + 1, released: LIMIT + 1, finallies: LIMIT + 1 })
    expect(depth.max).toBeLessThan(20)
    // Element n's cleanup finishes before element n + 1's body starts, and
    // `break` releases the producer before the loop exits.
    expect(events).toEqual([
      "acquire 0",
      "finally 0",
      "release 0",
      "acquire 1",
      "finally 1",
      "release 1",
      `acquire ${LIMIT}`,
      `finally ${LIMIT}`,
      `release ${LIMIT}`,
      "producer finalizer",
      "loop exited"
    ])
  })

  test("K11c tailResumeWith delivers a typed failure at the perform site; yielding a request instead of returning it is a defect", async () => {
    const Ask = operation<void, number, "Busy">("K11Ask")
    const body = Effect.catch(Ask(undefined), (e) => Effect.succeed(`body caught ${e}`))
    const delivered = await Effect.runPromiseExit(handle("h", [Ask], body, {
      K11Ask: Effect.fnUntraced(function*(_: void, k: Continuation) {
        return tailResumeWith(k, Effect.fail("Busy"))
      })
    }))
    expect(Exit.isSuccess(delivered) && delivered.value).toBe("body caught Busy")

    const { events, note } = recorder()
    const misused = await Effect.runPromiseExit(handle("h", [Ask], Ask(undefined).pipe(Effect.ensuring(note("segment released"))), {
      K11Ask: Effect.fnUntraced(function*(_: void, k: Continuation) {
        return yield* (tailResume(k, 1) as any)
      })
    }))
    expect(defects(misused).length).toBe(1)
    expect(events).toEqual(["segment released"])
  })

  test("K11d a resume enclosed by a finally region is not a tail resume: its cleanup runs after the resumed computation", async () => {
    // Source clause: Yield(n, k) { try { return resume(k, undefined) } finally { log(n) } }
    // The compiler keeps `yield* resume` inside the region; tailResume there
    // would run the finally first and change this order.
    const { events, note } = recorder()
    const exit = await Effect.runPromiseExit(handle("h", [Yield], Effect.andThen(counter(3), note("producer done")), {
      K11Yield: (n: number, k: Continuation) =>
        Effect.ensuring(Effect.andThen(note(`body ${n}`), resume(k, undefined)), note(`finally ${n}`))
    }))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(events).toEqual(["body 0", "body 1", "body 2", "producer done", "finally 2", "finally 1", "finally 0"])
  })
})

describe("K12 abandonment reports cleanup failures together with real interruptions", () => {
  const Ask = operation<void, void>("K12Ask")
  // A finalizer that is interrupted by a real fiber id and then dies.
  const interruptedThenDies = (id: number) =>
    Effect.withFiber((f) => Effect.andThen(Effect.sync(() => f.interruptUnsafe(id)), Effect.die("release-defect")))
  const expectBoth = (exit: Exit.Exit<unknown, unknown>, id: number) => {
    expect(defects(exit)).toEqual(["release-defect"])
    // The real interruption is reported; no abandonment sentinel (negative id) leaks.
    expect(interrupts(exit)).toEqual([id])
  }

  test("K12a explicit abandon from an interruptible clause (Codex R2b)", () => {
    const exit = Effect.runSyncExit(handle("h", [Ask], Ask().pipe(Effect.ensuring(interruptedThenDies(1201))), {
      K12Ask: (_, k) => abandon(k)
    }))
    expectBoth(exit, 1201)
  })

  test("K12b abandonNow from an interruptible clause fails at once with both reasons; the clause does not continue", () => {
    const { events, note } = recorder()
    const exit = Effect.runSyncExit(handle("h", [Ask], Ask().pipe(Effect.ensuring(interruptedThenDies(1202))), {
      K12Ask: (_, k) => Effect.andThen(abandonNow(k), note("clause continued (must not)"))
    }))
    expectBoth(exit, 1202)
    expect(events).toEqual([])
  })

  test("K12c owner exit: a clause that returns without resuming (Codex R2)", () => {
    const exit = Effect.runSyncExit(handle("h", [Ask], Ask().pipe(Effect.ensuring(interruptedThenDies(1203))), {
      K12Ask: () => Effect.succeed("stop")
    }))
    expectBoth(exit, 1203)
  })

  test("K12d Scope exit: an Effect.scoped region closes over a transferred continuation", () => {
    const exit = Effect.runSyncExit(Effect.scoped(handle("h", [Ask], Ask().pipe(Effect.ensuring(interruptedThenDies(1204))), {
      K12Ask: (_, k) => Effect.as(transfer(k), "parked")
    })))
    expectBoth(exit, 1204)
  })

  // K12c-e passed before the fix too (Owner frames and Scope.close mask the
  // abandonment, internal/effect.ts:3940-3944); they guard the shared law.
  test("K12e Scope exit: Scope.close called from an interruptible region", () => {
    const { events, note } = recorder()
    let k!: Continuation
    const exit = Effect.runSyncExit(Effect.gen(function*() {
      const scope = yield* Scope.make()
      yield* handle("h", [Ask], Ask().pipe(Effect.ensuring(interruptedThenDies(1205))), {
        K12Ask: (_, captured) => {
          k = captured
          return Effect.as(Effect.provideService(transfer(k), Scope.Scope, scope), "parked")
        }
      })
      yield* Scope.close(scope, Exit.void)
      yield* note("continued after close (must not)")
    }))
    expectBoth(exit, 1205)
    expect(k.state).toBe("abandoned")
    expect(events).toEqual([])
  })
})

describe("K13 a transferred continuation never outlives its capturing fiber", () => {
  const Ask = operation<void, void>("K13Ask")
  const release = (events: Array<string>, label = "release") =>
    Effect.withFiber((f) => Effect.sync(() => void events.push(`${label} on fiber ${f.id}`)))

  test("K13a a child transfers into its inherited parent Scope and exits: the segment is released on the child first (Codex R5)", async () => {
    const events: Array<string> = []
    let childId = 0
    let parked!: Suspended
    const body = Effect.scoped(Effect.gen(function*() {
      yield* Effect.acquireRelease(Effect.void, () => release(events))
      yield* Ask()
    }))
    const child = Effect.withFiber((f) => {
      childId = f.id
      return handle("h", [Ask], body, { K13Ask: (_, k) => transfer(k) })
    })
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(child)
      parked = yield* Fiber.join(fiber)
      events.push("parent joined")
      const late = yield* Effect.exit(resume(parked, undefined))
      events.push(`late resume: ${defects(late)[0]}`)
    })))
    // The parent's Scope closes last and finds nothing to abandon.
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(parked.k.state).toBe("abandoned")
    expect(events).toEqual([
      `release on fiber ${childId}`,
      "parent joined",
      "late resume: ContinuationAlreadyConsumed"
    ])
  })

  test("K13b the capturing fiber exits while the Scope it transferred into is still open", async () => {
    const events: Array<string> = []
    let k!: Continuation
    const exit = await Effect.runPromiseExit(Effect.gen(function*() {
      const scope = yield* Scope.make() // never closed
      yield* handle("h", [Ask], Ask().pipe(Effect.ensuring(release(events))), {
        K13Ask: (_, captured) => {
          k = captured
          return Effect.as(Effect.provideService(transfer(k), Scope.Scope, scope), "parked")
        }
      })
      events.push(`body returned, k ${k.state}`)
      return "done"
    }))
    expect(Exit.isSuccess(exit) && exit.value).toBe("done")
    expect(k.state).toBe("abandoned")
    expect(events.map((e) => e.replace(/fiber \d+/, "fiber"))).toEqual(["body returned, k suspended", "release on fiber"])
  })

  test("K13c an interrupted capturer releases the segment even after a cross-fiber close of its Scope failed", async () => {
    const events: Array<string> = []
    let childId = 0
    const exit = await Effect.runPromiseExit(Effect.gen(function*() {
      const scope = yield* Scope.make()
      const child = Effect.withFiber((f) => {
        childId = f.id
        return Effect.andThen(
          handle("h", [Ask], Ask().pipe(Effect.ensuring(release(events))), { K13Ask: (_, k) => transfer(k) }),
          Effect.never
        )
      }).pipe(Effect.provideService(Scope.Scope, scope))
      const fiber = yield* Effect.forkChild(child, { startImmediately: true })
      // Closing on the parent is still a defect (G3: cross-fiber consumption is open) ...
      const closed = yield* Effect.exit(Scope.close(scope, Exit.void))
      events.push(`parent close: ${defects(closed)[0]}`)
      // ... but the continuation is not stranded: the capturer releases it when it exits.
      yield* Fiber.interrupt(fiber)
      const childExit = yield* Fiber.await(fiber)
      events.push(`child exit: interrupted=${Exit.hasInterrupts(childExit)} defects=${defects(childExit).length}`)
    }))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(events).toEqual([
      "parent close: ContinuationWrongFiber",
      `release on fiber ${childId}`,
      "child exit: interrupted=true defects=0"
    ])
  })

  test("K13d a cleanup defect during exit-time abandonment fails the capturing fiber", async () => {
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(handle("h", [Ask], Ask().pipe(Effect.ensuring(Effect.die("release-defect"))), {
        K13Ask: (_, k) => transfer(k)
      }))
      return yield* Fiber.join(fiber)
    })))
    expect(defects(exit)).toEqual(["release-defect"])
  })

  test("K13e transfer into a Scope with parallel finalizers is rejected; the clause's owner abandons k", () => {
    const events: Array<string> = []
    const exit = Effect.runSyncExit(Effect.gen(function*() {
      const scope = yield* Scope.make("parallel")
      return yield* handle("h", [Ask], Ask().pipe(Effect.ensuring(release(events))), {
        K13Ask: (_, k) => Effect.provideService(transfer(k), Scope.Scope, scope)
      })
    }))
    expect(defects(exit)).toEqual(["TransferIntoParallelScope"])
    expect(events.length).toBe(1)
  })
})

describe("K14 source catch recovers expected failures only", () => {
  test("K14a a cause made only of expected failures is recovered; the handler receives the first", () => {
    const one = Effect.runSyncExit(catchExpected(Effect.fail("NotFound"), (e) => Effect.succeed(`recovered ${e}`)))
    expect(Exit.isSuccess(one) && one.value).toBe("recovered NotFound")
    const two = Effect.runSyncExit(catchExpected(
      Effect.failCause(Cause.combine(Cause.fail("first"), Cause.fail("second"))),
      (e) => Effect.succeed(`recovered ${e}`)
    ))
    expect(Exit.isSuccess(two) && two.value).toBe("recovered first")
  })

  test("K14b the generated try/catch/finally re-raises an expected failure that carries a cleanup defect, as defects (Codex R1)", () => {
    // Source: try { return find(id) } catch (e) { return guest } finally { log("finally") }
    // where find's own cleanup dies while find fails with UserNotFound.
    // Effect 4.1.0 gives the defect precedence where it combines the two
    // (Effect-TS/effect#9433): UserNotFound arrives as a defect, first.
    const { events, note } = recorder()
    const find = Effect.ensuring(Effect.fail("UserNotFound"), Effect.die("release-defect"))
    let handled = 0
    const profile = Effect.ensuring(
      catchExpected(
        Effect.fnUntraced(function*() {
          return yield* find
        })(),
        () => Effect.sync(() => (handled++, "guest"))
      ),
      note("finally")
    )
    const exit = Effect.runSyncExit(profile)
    expect(handled).toBe(0)
    expect(fails(exit)).toEqual([])
    expect(defects(exit)).toEqual(["UserNotFound", "release-defect"])
    expect(events).toEqual(["finally"])
    // Effect.catch, the previous lowering, no longer recovers either
    // (Effect-TS/effect#9516); on 4.0.5 it recovered and dropped the defect.
    expect(defects(Effect.runSyncExit(Effect.catch(find, () => Effect.succeed("guest"))))).toEqual(["UserNotFound", "release-defect"])
  })

  test("K14c an expected failure beside an interruption is recovered and the interruption dropped, as Effect.catch does (D306); a defect alone and an interruption alone pass through", () => {
    const handler = (e: string) => Effect.succeed(`recovered ${e}`)
    const mixed = Cause.combine(Cause.combine(Cause.interrupt(1403), Cause.fail("Busy")), Cause.fail("Second"))
    expect(Effect.runSyncExit(catchExpected(Effect.failCause(mixed), handler))).toEqual(Exit.succeed("recovered Busy"))
    expect(Effect.runSyncExit(Effect.catch(Effect.failCause(mixed), handler))).toEqual(Exit.succeed("recovered Busy"))
    expect(defects(Effect.runSyncExit(catchExpected(Effect.die("bug"), handler)))).toEqual(["bug"])
    expect(Exit.hasInterrupts(Effect.runSyncExit(catchExpected(Effect.interrupt, handler)))).toBe(true)
  })

  test("K14d a failure raised while a handler abandons a continuation passes a catch inside it untouched", () => {
    // Masked, the abandoned segment reaches its catch frame (interruptibly,
    // Effect's skip loop passes it). Recovering there would resume abandoned
    // code and lose the cleanup failure.
    const Ask = operation<void, void>("K14dAsk")
    let handled = 0
    const exit = Effect.runSyncExit(handle(
      "h",
      [Ask],
      Effect.uninterruptible(catchExpected(Effect.onExit(Ask(), () => Effect.fail("cleanup")), () => Effect.sync(() => ++handled))),
      { K14dAsk: () => Effect.succeed("stop") }
    ))
    expect(handled).toBe(0)
    expect(fails(exit)).toEqual(["cleanup"])
    expect(defects(exit)).toEqual([])
  })
})

describe("K16 the kernel gives defects precedence where it combines causes, as Effect 4.1.0 does (D305)", () => {
  const Ask = operation<void, void>("K16Ask")

  test("K16a a clause that fails while its owner abandons a continuation whose cleanup dies fails with both, as defects, in order", () => {
    const exit = Effect.runSyncExit(handle("h", [Ask], Ask().pipe(Effect.ensuring(Effect.die("release-defect"))), {
      K16Ask: () => Effect.fail("E")
    }))
    expect(fails(exit)).toEqual([])
    expect(defects(exit)).toEqual(["E", "release-defect"])
  })

  test("K16b a fiber that fails while its exit abandons a transferred continuation whose cleanup dies", async () => {
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(handle("h", [Ask], Ask().pipe(Effect.ensuring(Effect.die("release-defect"))), {
        K16Ask: (_, k) => Effect.andThen(transfer(k), Effect.fail("E"))
      }))
      return yield* Fiber.join(fiber)
    })))
    expect(fails(exit)).toEqual([])
    expect(defects(exit)).toEqual(["E", "release-defect"])
  })

  test("K16c an expected cleanup failure beside the clause's failure stays expected", () => {
    const exit = Effect.runSyncExit(handle("h", [Ask], Ask().pipe(Effect.onExit(() => Effect.fail("cleanup"))), {
      K16Ask: () => Effect.fail("E")
    }))
    expect(fails(exit)).toEqual(["E", "cleanup"])
    expect(defects(exit)).toEqual([])
  })

  test("K16d catchExpected re-fails a cause with a defect with its failures as defects; the handler never runs", () => {
    let handled = 0
    const exit = Effect.runSyncExit(catchExpected(
      Effect.failCause(Cause.combine(Cause.combine(Cause.fail("E"), Cause.interrupt(1604)), Cause.die("D"))),
      () => Effect.sync(() => ++handled)
    ))
    expect(handled).toBe(0)
    expect(Exit.isFailure(exit) && exit.cause.reasons.map((r) => r._tag)).toEqual(["Die", "Interrupt", "Die"])
    expect(defects(exit)).toEqual(["E", "D"])
  })
})

describe("K15 suspend inside Effect.acquireRelease: masked versus interruptible acquisition", () => {
  type Socket = { readonly id: number; destroyed: number }

  // The Chapter 6 adapter. `release` on suspend covers a value accepted by the
  // gate but not yet delivered when cancellation wins (deferred wake-up).
  const adapter = (events: Array<string>, acquireOptions?: { readonly interruptible?: boolean }) => {
    let waiter: Resumer<Socket> | undefined
    const destroy = (socket: Socket, who: string) => {
      socket.destroyed++
      events.push(`${who} destroyed socket ${socket.id}`)
    }
    const connect = Effect.acquireRelease(
      suspend<Socket>((w) => {
        waiter = w
        return () => events.push("registration cleanup")
      }, { release: (socket) => destroy(socket, "suspend release") }),
      (socket) => Effect.sync(() => destroy(socket, "acquireRelease release")),
      acquireOptions
    )
    const session = Effect.scoped(Effect.flatMap(connect, () => Effect.sync(() => events.push("handshake (must not run)"))))
    // The producer's `connect` event.
    const onConnect = (socket: Socket) => {
      if (waiter!.resume(socket)) events.push(`resume accepted ${socket.id}`)
      else destroy(socket, "producer (late)")
    }
    return { session, onConnect }
  }

  test("K15a default acquireRelease masks the wait: interruption waits for the value, which is then released", async () => {
    const events: Array<string> = []
    const { session, onConnect } = adapter(events)
    const fiber = Effect.runFork(session, { startImmediately: true })
    fiber.interruptUnsafe(1501)
    expect(fiber.pollUnsafe()).toBeUndefined() // still parked: the request is only recorded
    const socket: Socket = { id: 1, destroyed: 0 }
    onConnect(socket)
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(interrupts(exit)).toEqual([1501])
    expect(socket.destroyed).toBe(1)
    // The wake-up runs the fiber synchronously, so release precedes the
    // producer's own log line; the cancellation hook never runs.
    expect(events).toEqual(["acquireRelease release destroyed socket 1", "resume accepted 1"])
  })

  test("K15b interruptible acquisition: cancellation wins at once and the late value stays the producer's to release", async () => {
    const events: Array<string> = []
    const { session, onConnect } = adapter(events, { interruptible: true })
    const fiber = Effect.runFork(session, { startImmediately: true })
    fiber.interruptUnsafe(1502)
    const exit = fiber.pollUnsafe()
    expect(exit !== undefined && interrupts(exit)).toEqual([1502])
    const socket: Socket = { id: 2, destroyed: 0 }
    onConnect(socket)
    expect(socket.destroyed).toBe(1)
    expect(events).toEqual(["registration cleanup", "producer (late) destroyed socket 2"])
  })

  test("K15c interruptible acquisition: a value accepted but not yet delivered when cancellation wins is released by suspend", async () => {
    const events: Array<string> = []
    const budget = wakeConfig.budget
    wakeConfig.budget = 0 // every wake-up is deferred to the scheduler
    try {
      const { session, onConnect } = adapter(events, { interruptible: true })
      const fiber = Effect.runFork(session, { startImmediately: true })
      const socket: Socket = { id: 3, destroyed: 0 }
      onConnect(socket) // accepted: the kernel owns the value until the task runs
      fiber.interruptUnsafe(1503)
      const exit = await Effect.runPromise(Fiber.await(fiber))
      await new Promise((resolve) => setTimeout(resolve, 5)) // let the deferred task run
      expect(interrupts(exit)).toEqual([1503])
      expect(socket.destroyed).toBe(1)
      expect(events).toEqual(["resume accepted 3", "suspend release destroyed socket 3", "registration cleanup"])
    } finally {
      wakeConfig.budget = budget
    }
  })
})

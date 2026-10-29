import { expect, test } from "bun:test"
import { Cause, Context, Effect, Exit, Fiber } from "effect"
import { abandon, catchExpected, handle, hooks, operation, resume, resumeWith, suspend, tailResume, transfer, type Suspended } from "../../packages/runtime/src/kernel/kernel.ts"
import * as Reference from "../reference-machine/kernel.ts"

// Counterexamples are asserted as observations, not as desired semantics.
// 2026-10-16 kernel fixes (experiments/KERNEL-CHANGES.md): Boundary 2b and Boundary 5 now
// assert the fixed behavior; Boundary 1, Boundary 3 and Boundary 10 still record Effect's behavior or
// the non-tail clause shape, with the replacement shown next to each.
const reasons = (exit: Exit.Exit<unknown, unknown>) => Exit.isFailure(exit)
  ? exit.cause.reasons.map(r => r._tag === "Die" ? [r._tag, String(r.defect)] : r._tag)
  : ["Success", exit.value]

test("Boundary 1 Effect.catch preserves defects when the body also fails (Effect 4.1.0)", () => {
  const body = Effect.ensuring(Effect.fail("expected"), Effect.die("release-defect"))
  const before = Effect.runSyncExit(body)
  const after = Effect.runSyncExit(Effect.catch(body, () => Effect.succeed("recovered")))
  console.log("Boundary 1", JSON.stringify({ before: reasons(before), after: reasons(after) }))
  expect(Exit.isFailure(before) && before.cause.reasons.map(r => r._tag)).toEqual(["Die", "Die"])
  expect(reasons(after)).toEqual([["Die", "expected"], ["Die", "release-defect"]])
  // Both the source catch and Effect.catch preserve the elected defects (D305).
  const lowered = Effect.runSyncExit(catchExpected(body, () => Effect.succeed("recovered")))
  expect(Exit.isFailure(lowered) && lowered.cause.reasons.map(r => r._tag)).toEqual(["Die", "Die"])
})

test("Boundary 2 owner-driven abandonment retains a cleanup defect alongside interruption", () => {
  const Ask = operation<void, void>("regression/boundary-2")
  const finalizer = Effect.withFiber(f => Effect.andThen(
    Effect.sync(() => f.interruptUnsafe(8802)), Effect.die("release-defect")))
  const body = Effect.ensuring(Ask(), finalizer)
  const result = Effect.runSyncExit(handle("h", [Ask], body, {
    "regression/boundary-2": () => Effect.succeed("stop")
  }))
  console.log("Boundary 2", JSON.stringify(reasons(result)))
  expect(Exit.hasInterrupts(result)).toBe(true)
  expect(Exit.isFailure(result) && result.cause.reasons.some(Cause.isDieReason)).toBe(true)
})

test("Boundary 2b explicit abandon keeps a cleanup defect when real interruption is pending (fixed; K12a)", () => {
  const Ask = operation<void, void>("regression/boundary-2b")
  const finalizer = Effect.withFiber(f => Effect.andThen(
    Effect.sync(() => f.interruptUnsafe(8822)), Effect.die("release-defect")))
  const result = Effect.runSyncExit(handle("h", [Ask], Effect.ensuring(Ask(), finalizer), {
    "regression/boundary-2b": (_, k) => abandon(k)
  }))
  console.log("Boundary 2b", JSON.stringify(reasons(result)))
  expect(Exit.hasInterrupts(result)).toBe(true)
  // Before the fix this was false: AbandonCollector.finish failed with the
  // pending interruption alone.
  expect(Exit.isFailure(result) && result.cause.reasons.some(Cause.isDieReason)).toBe(true)
})

// Unchanged Effect behavior (the masked default is correct for its policy).
// K15b/K15c test the interruptible acquisition the adapter needs.
test("Boundary 3 default acquireRelease shields suspend from cancellation", async () => {
  let waiter!: { resume(value: number): boolean }
  let cancelled = 0
  let released = 0
  const effect = Effect.scoped(Effect.acquireRelease(
    suspend<number>(w => { waiter = w; return () => { cancelled++ } }),
    () => Effect.sync(() => { released++ })
  ))
  const fiber = Effect.runFork(effect, { startImmediately: true })
  fiber.interruptUnsafe(8803)
  const pending = { exited: fiber.pollUnsafe() !== undefined, cancelled, released }
  console.log("Boundary 3 before delivery", JSON.stringify(pending))
  expect(pending).toEqual({ exited: false, cancelled: 0, released: 0 })
  // Finish the deliberately parked fiber without leaking a process/task.
  waiter.resume(1)
  const result = await Effect.runPromise(Fiber.await(fiber))
  expect(Exit.hasInterrupts(result)).toBe(true)
  expect(released).toBe(1)
})

test("Boundary 4 inlining a trusted sync operation removes an interruption boundary", () => {
  const run = (direct: boolean) => {
    const events: string[] = []
    const effect = Effect.withFiber(f => direct
      ? Effect.sync(() => { f.interruptUnsafe(8804); events.push("after") })
      : Effect.gen(function*() {
          yield* Effect.sync(() => f.interruptUnsafe(8804))
          events.push("after")
        }))
    const result = Effect.runSyncExit(effect)
    return { events, result: reasons(result) }
  }
  const framed = run(false)
  const direct = run(true)
  console.log("Boundary 4", JSON.stringify({ framed, direct }))
  expect(framed.events).toEqual([])
  expect(direct.events).toEqual(["after"])
})

test("Boundary 5 transfer from a child into its inherited Scope no longer strands the segment (fixed; K13a)", async () => {
  const Ask = operation<void, void>("regression/boundary-5")
  let acquired = 0
  let released = 0
  let parked!: Suspended
  const body = Effect.scoped(Effect.gen(function*() {
    yield* Effect.acquireRelease(Effect.sync(() => { acquired++; return {} }),
      () => Effect.sync(() => { released++ }))
    yield* Ask()
  }))
  const child = handle("h", [Ask], body, {
    "regression/boundary-5": (_, k) => transfer(k)
  })
  const program = Effect.scoped(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(child)
    parked = yield* Fiber.join(fiber)
  }))
  const result = await Effect.runPromiseExit(program)
  console.log("Boundary 5", JSON.stringify({ result: reasons(result), state: parked.k.state, acquired, released }))
  // Before the fix: ContinuationWrongFiber at the parent's Scope close, k
  // still suspended, released 0. Now the child abandons k before it exits.
  expect(Exit.isSuccess(result)).toBe(true)
  expect(parked.k.state).toBe("abandoned")
  expect(acquired).toBe(1)
  expect(released).toBe(1)
})

test("Boundary 6 a TypeScript wrapper can fork its closed-over operation without receiving a program argument", async () => {
  const Ask = operation<void, number>("regression/boundary-6")
  // Models an imported () => Effect<number, never, AskRequirement>.
  // There is no callback/program argument for a fiber-behavior table to inspect.
  const importedWrapper = () => Effect.timeout(Ask(), "1 second")
  const result = await Effect.runPromiseExit(handle("h", [Ask], importedWrapper(), {
    "regression/boundary-6": (_, k) => resume(k, 42)
  }))
  console.log("Boundary 6", JSON.stringify(reasons(result)))
  expect(Exit.isFailure(result) && result.cause.reasons.some(r =>
    Cause.isDieReason(r) && (r.defect as any)._tag === "HandlerNotOnThisFiber")).toBe(true)
})

test("Boundary 7 a provider around resumeWith cannot satisfy the injected program's R", () => {
  class Secret extends Context.Service<Secret, string>()("review/Secret") {}
  const Ask = operation<void, string>("regression/boundary-7")
  const result = Effect.runSyncExit(handle("h", [Ask], Ask(), {
    "regression/boundary-7": (_, k) => Effect.provideService(resumeWith(k, Secret), Secret, "clause-secret")
  }))
  console.log("Boundary 7", JSON.stringify(reasons(result)))
  expect(Exit.isFailure(result) && result.cause.reasons.some(Cause.isDieReason)).toBe(true)
})

test("Boundary 8 block-wide Scope also closes acquisitions that are not marked using", () => {
  const events: string[] = []
  const resource = (name: string) => Effect.acquireRelease(
    Effect.sync(() => ({ name, open: true })),
    (value) => Effect.sync(() => { value.open = false; events.push(name) })
  )
  // Proposed block lowering for:
  // const escaped = acquire(); using temporary = acquire(); return escaped;
  const result = Effect.runSync(Effect.scoped(Effect.gen(function*() {
    const escaped = yield* resource("not-using")
    yield* resource("using")
    return escaped
  })))
  console.log("Boundary 8", JSON.stringify({ result, events }))
  expect(result.open).toBe(false)
  expect(events).toEqual(["using", "not-using"])
})

test("Boundary 9 the two machines disagree about the next clause's Context after resume", async () => {
  class Logger extends Context.Service<Logger, string>()("regression/boundary-9Logger") {}
  const Ask = operation<string, string>("regression/boundary-9")
  const nativeBody = Effect.provideService(Effect.gen(function*() {
    const first = yield* Ask("first")
    const bodyContext = yield* Logger
    const second = yield* Ask("second")
    return [first, bodyContext, second]
  }), Logger, "body")
  const native = await Effect.runPromise(Effect.provideService(handle("h", [Ask], nativeBody, {
    "regression/boundary-9": (label, k) => Effect.flatMap(Logger, value => label === "first"
      ? Effect.provideService(resume(k, `${label}@${value}`), Logger, "resume-site")
      : resume(k, `${label}@${value}`))
  }), Logger, "handle-site"))
  const R = Reference
  const referenceBody = R.provide(R.bind(R.perform("Ask", "first"), first =>
    R.bind(R.lift(Logger), bodyContext => R.bind(R.perform("Ask", "second"), second =>
      R.pure([first, bodyContext, second])))), Logger, "body")
  const reference = await Effect.runPromise(R.run(R.provide(R.handle(referenceBody, {
    Ask: (label, k) => R.bind(R.lift(Logger), value => label === "first"
      ? R.provide(R.resume(k, `${label}@${value}`), Logger, "resume-site")
      : R.resume(k, `${label}@${value}`))
  }), Logger, "handle-site")))
  console.log("Boundary 9", JSON.stringify({ native, reference }))
  expect(native).toEqual(["first@handle-site", "body", "second@resume-site"])
  expect(reference).toEqual(["first@handle-site", "body", "second@handle-site"])
})

test("Boundary 10 the documented generator clause defeats the constant-stack tail-resume optimization", () => {
  const Yield = operation<number, void>("regression/boundary-10Yield")
  const measure = (count: number) => {
    let maxDepth = 0
    hooks.onResume = f => { maxDepth = Math.max(maxDepth, f._stack.length) }
    try {
      const producer = Effect.gen(function*() {
        for (let i = 0; i < count; i++) yield* Yield(i)
      })
      Effect.runSync(handle("for-of", [Yield], producer, {
        // Exactly the generator-style clause shown in design lines 2414-2419.
        "regression/boundary-10Yield": (_, k) => Effect.gen(function*() {
          return yield* resume(k, undefined)
        })
      }))
      return maxDepth
    } finally { delete hooks.onResume }
  }
  const n100 = measure(100)
  const n1000 = measure(1000)
  console.log("Boundary 10", JSON.stringify({ n100, n1000 }))
  // Still true by construction: `return yield* resume(k)` is not a tail
  // resume (now 3 frames per element: Owner, Clause, Iterator).
  expect(n1000).toBeGreaterThan(1000)
  expect(n1000).toBeGreaterThan(n100 * 5)
  // The lowering the compiler must emit instead (K11a): return the request.
  let flat = 0
  hooks.onResume = f => { flat = Math.max(flat, f._stack.length) }
  try {
    Effect.runSync(handle("for-of", [Yield], Effect.gen(function*() {
      for (let i = 0; i < 1000; i++) yield* Yield(i)
    }), {
      "regression/boundary-10Yield": (_, k) => Effect.gen(function*() {
        return tailResume(k, undefined)
      })
    }))
  } finally { delete hooks.onResume }
  console.log("Boundary 10 tailResume", JSON.stringify({ n1000: flat }))
  expect(flat).toBeLessThan(20)
})

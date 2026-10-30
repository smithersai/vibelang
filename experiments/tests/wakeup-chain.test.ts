// F10: cross-fiber wake-up chains on effect@4.1.0, and the kernel's fix.
// Fiber i waits for its own wake-up and then wakes fiber i + 1. Effect runs a
// woken fiber synchronously on the waker's JS stack (effect-facts F6), so a
// long chain nests run loops.
import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Tracer } from "effect"
import { suspend, wakeConfig } from "../../packages/runtime/src/kernel/kernel.ts"

const settle = Effect.sleep("50 millis")

const defects = (fibers: ReadonlyArray<Fiber.Fiber<unknown, unknown>>) =>
  fibers
    .map((fiber) => fiber.pollUnsafe())
    .filter((exit): exit is Exit.Failure<unknown, unknown> => exit !== undefined && Exit.isFailure(exit))
    .map((exit) => String(Cause.squash(exit.cause)))

test("F10a Effect: a Deferred wake-up chain exhausts a bounded stack and strands the rest", async () => {
  const N = 5_000
  const stackBudget = 64
  let depth = 0
  let exhausted = false
  const tracer: Tracer.Tracer = {
    ...Effect.runSync(Effect.service(Tracer.Tracer)),
    context(primitive, fiber) {
      depth++
      try {
        // A real host overflow can leave Effect spinning in its error handler:
        // the handler needs the same exhausted stack. Trip a logical budget
        // once, with native headroom for recovery, to measure the unbounded
        // inline wake-up chain independently of JIT and host stack size.
        if (depth > stackBudget && !exhausted) {
          exhausted = true
          throw new RangeError("Maximum call stack size exceeded (F10a logical stack budget)")
        }
        return primitive["~effect/Effect/evaluate"](fiber)
      } finally {
        depth--
      }
    }
  }
  const result = await Effect.runPromise(Effect.gen(function*() {
    const gates = yield* Effect.forEach(Array.from({ length: N + 1 }), () => Deferred.make<number>())
    const fibers: Array<Fiber.Fiber<unknown, unknown>> = []
    let reached = -1
    for (let i = 0; i < N; i++) {
      const here = gates[i]!
      const next = gates[i + 1]!
      fibers.push(yield* Effect.forkChild(Effect.flatMap(Deferred.await(here), (n) => {
        reached = n
        return Deferred.succeed(next, n + 1)
      })))
    }
    yield* Effect.yieldNow
    yield* Deferred.succeed(gates[0]!, 0)
    yield* settle
    const finished = yield* Deferred.isDone(gates[N]!)
    return { reached, finished, defects: defects(fibers) }
  }).pipe(Effect.provideService(Tracer.Tracer, tracer)))
  console.log(`\n--- F10a reached ${result.reached} of ${N}; defects: ${result.defects.length} (${result.defects[0]?.slice(0, 50)})`)
  expect(result.finished).toBe(false)
  expect(result.reached).toBeLessThan(N - 1)
  expect(result.reached).toBeLessThan(stackBudget)
  expect(exhausted).toBe(true)
  expect(result.defects.length).toBe(1)
  expect(result.defects[0]).toContain("Maximum call stack size exceeded")
})

test("K10a kernel: a chain of 100000 suspend wake-ups completes", async () => {
  const N = 100_000
  const resumers: Array<{ resume: (n: number) => boolean }> = []
  const exit = await Effect.runPromiseExit(Effect.gen(function*() {
    const done = yield* Deferred.make<number>()
    for (let i = 0; i < N; i++) {
      yield* Effect.forkChild(Effect.gen(function*() {
        const n = yield* suspend<number>((r) => void (resumers[i] = r))
        if (i + 1 < N) resumers[i + 1]!.resume(n + 1)
        else yield* Deferred.succeed(done, n)
      }))
    }
    yield* Effect.yieldNow
    resumers[0]!.resume(0)
    return yield* Deferred.await(done)
  }))
  expect(Exit.isSuccess(exit) && exit.value).toBe(N - 1)
})

test("K10b kernel: cancellation that beats a deferred delivery releases the value", async () => {
  const released: Array<string> = []
  const previous = wakeConfig.budget
  wakeConfig.budget = 0 // force every delivery to be deferred
  try {
    let resumer: { resume: (v: string) => boolean } | undefined
    const exit = await Effect.runPromiseExit(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        suspend<string>((r) => void (resumer = r), { release: (v) => void released.push(v) })
      )
      yield* Effect.sleep("1 millis")
      const accepted = resumer!.resume("connection-1") // deferred, not yet delivered
      yield* Fiber.interrupt(fiber) // cancellation wins before the task runs
      yield* settle
      return { accepted, exit: yield* Fiber.await(fiber) }
    }))
    expect(Exit.isSuccess(exit) && exit.value.accepted).toBe(true)
    expect(Exit.isSuccess(exit) && Exit.hasInterrupts(exit.value.exit)).toBe(true)
    expect(released).toEqual(["connection-1"])
  } finally {
    wakeConfig.budget = previous
  }
})

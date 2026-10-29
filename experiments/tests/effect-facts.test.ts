// Facts about the unmodified Effect 4.1.0 runtime that the design relies on.
// These test Effect, not VibeLang; the kernel tests cover the language model.
import { describe, expect, test } from "bun:test"
import { Context, Effect, Exit, Fiber, Latch } from "effect"

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromiseExit(effect)

describe("Effect.gen is not a delimited-control implementation", () => {
  test("F1 a JS finally inside Effect.gen does not run when a yielded effect fails", async () => {
    const events: Array<string> = []
    const program = Effect.gen(function*() {
      try {
        yield* Effect.fail("boom")
      } finally {
        events.push("generator finally")
      }
    })
    const exit = await run(program)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(events).toEqual([])
  })

  test("F2 a JS finally inside Effect.gen does not run when the fiber is interrupted", async () => {
    const events: Array<string> = []
    const exit = await run(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Effect.gen(function*() {
        try {
          yield* Effect.never
        } finally {
          events.push("generator finally")
        }
      }))
      yield* Effect.sleep("1 millis")
      yield* Fiber.interrupt(fiber)
      return yield* Fiber.await(fiber)
    }))
    expect(Exit.isSuccess(exit) && Exit.hasInterrupts(exit.value)).toBe(true)
    expect(events).toEqual([])
  })

  test("F3 a JS try/catch around a failing yield* does not catch", async () => {
    const program = Effect.gen(function*() {
      try {
        yield* Effect.fail("boom")
        return "not reached"
      } catch {
        return "caught by JS"
      }
    })
    const exit = await run(program)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("F4 a JS exception thrown by a generator body is a defect, not a typed failure", async () => {
    const program = Effect.gen(function*() {
      yield* Effect.void
      throw new Error("thrown")
    })
    const exit = await run(program)
    expect(Exit.isFailure(exit) && exit.cause.reasons[0]!._tag).toBe("Die")
  })
})

describe("suspension and resumption", () => {
  test("F5 Effect.callback ignores every resume after the first", async () => {
    const exit = await run(Effect.callback<number>((resume) => {
      resume(Effect.succeed(1))
      resume(Effect.succeed(2))
    }))
    expect(Exit.isSuccess(exit) && exit.value).toBe(1)
  })

  test("F6 an asynchronous resume runs the fiber synchronously on the resumer's stack", async () => {
    const events: Array<string> = []
    let resume: ((effect: Effect.Effect<void>) => void) | undefined
    const waiter = Effect.andThen(
      Effect.callback<void>((r) => void (resume = r)),
      Effect.sync(() => void events.push("waiter continued"))
    )
    const exit = await run(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(waiter)
      yield* Effect.sleep("1 millis")
      events.push("before resume")
      resume!(Effect.void)
      events.push("after resume")
      return yield* Fiber.await(fiber)
    }))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(events).toEqual(["before resume", "waiter continued", "after resume"])
  })
})

describe("Context and structured concurrency", () => {
  class Tag extends Context.Service<Tag, string>()("facts/Tag") {}

  test("F7 a child snapshots the parent's Context at fork; later changes do not flow either way", async () => {
    const exit = await run(Effect.gen(function*() {
      const latch = yield* Latch.make()
      const child = yield* Effect.forkChild(Effect.gen(function*() {
        yield* latch.await
        const seen = yield* Tag
        const inner = yield* Effect.provideService(Effect.service(Tag), Tag, "child-override")
        return [seen, inner]
      }))
      const parentLater = yield* Effect.provideService(
        Effect.andThen(latch.open, Effect.service(Tag)),
        Tag,
        "parent-later"
      )
      const childSaw = yield* Fiber.join(child)
      const parentAfter = yield* Tag
      return { childSaw, parentLater, parentAfter }
    }).pipe(Effect.provideService(Tag, "at-fork")))
    expect(Exit.isSuccess(exit) && exit.value).toEqual({
      childSaw: ["at-fork", "child-override"],
      parentLater: "parent-later",
      parentAfter: "at-fork"
    })
  })

  test("F8 forkChild children are interrupted when the parent completes", async () => {
    const events: Array<string> = []
    const exit = await run(Effect.gen(function*() {
      yield* Effect.forkChild(Effect.onInterrupt(Effect.never, () => Effect.sync(() => void events.push("child interrupted"))))
      yield* Effect.sleep("1 millis")
      return "parent done"
    }))
    expect(Exit.isSuccess(exit) && exit.value).toBe("parent done")
    expect(events).toEqual(["child interrupted"])
  })
})

describe("host stack limits", () => {
  test("F9 measure the direct-style recursion depth the host allows", () => {
    const direct = (n: number): number => (n === 0 ? 0 : direct(n - 1) + 1)
    let low = 1_000
    let high = 10_000_000
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2)
      try {
        direct(mid)
        low = mid
      } catch {
        high = mid
      }
    }
    console.log(`\n--- F9 direct recursion limit on this host (bun ${Bun.version}): ~${low} frames`)
    expect(low).toBeLessThan(10_000_000)
  })
})

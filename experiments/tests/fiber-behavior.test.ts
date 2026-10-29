// G2 (partial): which Effect 4.1.0 combinators run their argument on the
// performing fiber? Each probe performs a control operation inside the
// combinator, under a handler outside it. "same" means the handler was reached
// (capture passed through the combinator); "other" means HandlerNotOnThisFiber.
import { describe, expect, test } from "bun:test"
import { Cause, Context, Effect, Exit, Fiber, Layer, Schedule } from "effect"
import { type Continuation, handle, operation, resume } from "../../packages/runtime/src/kernel/kernel.ts"

const Ask = operation<void, number>("FiberProbe")

const probe = async (wrap: (op: Effect.Effect<number>) => Effect.Effect<unknown, unknown, never>) => {
  const exit = await Effect.runPromiseExit(
    handle("probe", [Ask], wrap(Ask(undefined)), { FiberProbe: (_: void, k: Continuation) => resume(k, 1) })
  )
  if (Exit.isSuccess(exit)) return "same"
  const die = exit.cause.reasons.find(Cause.isDieReason)
  return (die?.defect as any)?._tag === "HandlerNotOnThisFiber" ? "other" : `unexpected: ${Cause.pretty(exit.cause)}`
}

describe("combinators that keep the argument on the performing fiber", () => {
  const cases: Array<[string, (op: Effect.Effect<number>) => Effect.Effect<unknown, unknown, never>]> = [
    ["flatMap", (op) => Effect.flatMap(Effect.void, () => op)],
    ["map", (op) => Effect.map(op, (n) => n + 1)],
    ["catch", (op) => Effect.catch(op, () => Effect.succeed(0))],
    ["catchCause", (op) => Effect.catchCause(op, () => Effect.succeed(0))],
    ["ensuring", (op) => Effect.ensuring(op, Effect.void)],
    ["onExit", (op) => Effect.onExit(op, () => Effect.void)],
    ["provideService", (op) => Effect.provideService(op, Context.Service<string>("probe/Tag"), "x")],
    ["scoped", (op) => Effect.scoped(op)],
    ["acquireRelease (acquire)", (op) => Effect.scoped(Effect.acquireRelease(op, () => Effect.void))],
    ["acquireUseRelease (use)", (op) => Effect.acquireUseRelease(Effect.void, () => op, () => Effect.void)],
    ["retry", (op) => Effect.retry(op, Schedule.recurs(1))],
    ["repeat", (op) => Effect.repeat(op, Schedule.recurs(1))],
    ["uninterruptible", (op) => Effect.uninterruptible(op)],
    ["forEach, concurrency unset", (op) => Effect.forEach([1, 2], () => op)],
    ["forEach, concurrency 1", (op) => Effect.forEach([1, 2], () => op, { concurrency: 1 })],
    ["all, sequential", (op) => Effect.all([op, op])],
    ["zip, default", (op) => Effect.zip(op, op)]
  ]
  for (const [name, wrap] of cases) {
    test(name, async () => expect(await probe(wrap)).toBe("same"))
  }
})

describe("combinators that move the argument to another fiber", () => {
  const cases: Array<[string, (op: Effect.Effect<number>) => Effect.Effect<unknown, unknown, never>]> = [
    ["timeout", (op) => Effect.timeout(op, "1 second")],
    ["race (first success; the other branch fails)", (op) => Effect.race(op, Effect.fail("other branch"))],
    ["raceFirst", (op) => Effect.raceFirst(op, Effect.never)],
    ["forEach, concurrency 2", (op) => Effect.forEach([1, 2], () => op, { concurrency: 2 })],
    ["all, unbounded", (op) => Effect.all([op, op], { concurrency: "unbounded" })],
    ["zip, concurrent: true", (op) => Effect.zip(op, op, { concurrent: true })],
    ["forkChild + join", (op) => Effect.flatMap(Effect.forkChild(op), Fiber.join)]
  ]
  for (const [name, wrap] of cases) {
    test(name, async () => expect(await probe(wrap)).toBe("other"))
  }
})

describe("ambiguous providers at run time", () => {
  test("A3 Layer.merge of two providers for one key: the later one wins, silently", async () => {
    class Tag extends Context.Service<Tag, string>()("probe/Ambiguous") {}
    const first = Layer.succeed(Tag, "first")
    const second = Layer.succeed(Tag, "second")
    const a = await Effect.runPromise(Effect.provide(Effect.service(Tag), Layer.merge(first, second)))
    const b = await Effect.runPromise(Effect.provide(Effect.service(Tag), Layer.merge(second, first)))
    expect([a, b]).toEqual(["second", "first"])
  })
})

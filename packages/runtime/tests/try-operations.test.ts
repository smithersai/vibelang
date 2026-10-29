import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit } from "effect"
import { $tryAll, $tryAllSettled, $tryAny, $tryRace } from "../src/fibers"

test("try.all starts all operands and preserves their order", async () => {
  const gate = Deferred.makeUnsafe<void>()
  const operands = [
    Effect.as(Deferred.await(gate), 1),
    Effect.as(Deferred.succeed(gate, undefined), 2)
  ] as const
  expect(await Effect.runPromise($tryAll(operands))).toEqual([1, 2])
})

test("try.race takes the first failure and interrupts its loser", async () => {
  let finalized = false
  const outcome = await Effect.runPromiseExit($tryRace([
    Effect.ensuring(Effect.never, Effect.sync(() => { finalized = true })),
    Effect.delay(Effect.fail("first"), "5 millis")
  ]))
  expect(outcome).toEqual(Exit.fail("first"))
  expect(finalized).toBe(true)
})

test("try.any retains every failure in completion order", async () => {
  const outcome = await Effect.runPromiseExit($tryAny([
    Effect.delay(Effect.fail("slow"), "10 millis"),
    Effect.fail("fast")
  ]))
  expect(Exit.isFailure(outcome) && outcome.cause.reasons.filter(Cause.isFailReason).map(r => r.error)).toEqual(["fast", "slow"])
  expect(await Effect.runPromise($tryAny([Effect.fail("bad"), Effect.succeed(3)]))).toBe(3)
})

test("try.allSettled returns Exit including defects and interruption", async () => {
  const result = await Effect.runPromise($tryAllSettled([
    Effect.succeed(1), Effect.fail("bad"), Effect.die("defect"), Effect.interrupt
  ]))
  expect(result[0]).toEqual(Exit.succeed(1))
  expect(result[1]).toEqual(Exit.fail("bad"))
  expect(result[2]).toEqual(Exit.die("defect"))
  expect(Exit.isFailure(result[3]) && result[3].cause.reasons.some(Cause.isInterruptReason)).toBe(true)
})

test("empty all and allSettled succeed; empty race and any stay pending", async () => {
  expect(await Effect.runPromise($tryAll([]))).toEqual([])
  expect(await Effect.runPromise($tryAllSettled([]))).toEqual([])
  for (const operation of [$tryRace, $tryAny]) {
    const result = await Effect.runPromise(Effect.raceAllFirst([
      Effect.as(operation([]), "finished"), Effect.delay(Effect.succeed("pending"), "5 millis")
    ]))
    expect(result).toBe("pending")
  }
})

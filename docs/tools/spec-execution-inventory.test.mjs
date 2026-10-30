import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Effect, Fiber } from "effect"
import { chapter } from "./spec-witness.mjs"
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("the inventory names language execution sites while preserving ordinary calls", () => {
  const text = running()
  const inventory = text.slice(0, text.indexOf('## `try`'))
  assert.ok(inventory.includes("| `join f` |"))
  assert.ok(inventory.includes("| `throw e` |"))
  assert.doesNotMatch(inventory, /A call never runs anything/)
  assert.match(inventory, /ordinary JavaScript/)
  assert.match(inventory, /explicit.*runners/)
})

test("a factory call does ordinary construction work and leaves its returned Effect cold", () => {
  let builds = 0, runs = 0
  const factory = () => { builds++; return Effect.sync(() => { runs++; return 7 }) }
  const cold = factory()
  assert.deepEqual([builds, runs], [1, 0])
  assert.equal(Effect.runSync(cold), 7)
  assert.deepEqual([builds, runs], [1, 1])
})

test("join runs Fiber.join and propagates the child's result or failure", async () => {
  const success = Effect.gen(function* () {
    const child = yield* Effect.forkChild(Effect.succeed(7))
    return yield* Fiber.join(child)
  })
  assert.equal(await Effect.runPromise(success), 7)
  const failure = Effect.gen(function* () {
    const child = yield* Effect.forkChild(Effect.fail("child"))
    return yield* Fiber.join(child)
  })
  const exit = await Effect.runPromiseExit(failure)
  assert.equal(exit._tag, "Failure")
  assert.deepEqual(exit.cause.reasons.map(reason => [reason._tag, reason.error]), [["Fail", "child"]])
})

test("typed throw runs Effect.fail without executing an Effect-valued error", () => {
  let ran = false
  const payload = Effect.sync(() => { ran = true })
  const exit = Effect.runSyncExit(Effect.gen(function* () { return yield* Effect.fail(payload) }))
  assert.equal(exit._tag, "Failure")
  assert.equal(exit.cause.reasons[0]._tag, "Fail")
  assert.equal(exit.cause.reasons[0].error, payload)
  assert.equal(ran, false)
})

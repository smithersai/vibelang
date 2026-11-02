import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { chapter, read, block, run } from "./spec-witness.mjs"

const repairs = [
  ["EK4609", "await runPromise(Fiber.join(fiber))"],
  ["EK4610", "await runPromise(Deferred.await(deferred))"],
]

test("async Fiber/Deferred warnings suggest a repair valid in their source context", () => {
  const appendix = chapter("900-appendices")
  const running = chapter("002-running")
  for (const [code, repair] of repairs) {
    const row = appendix.split("\n").find(line => line.startsWith("| `" + code + "` |"))
    assert.ok(row?.includes("lint warning"), code + " retains warning severity")
    assert.ok(row.includes(repair), code + " needs an explicit Promise bridge")
    assert.ok(running.includes(repair), code + " needs the same canonical repair")
    assert.ok(chapter("007-tooling").includes(repair), code + " needs a context-valid tooling repair")
  }
  assert.ok(running.includes("native `await` behavior"))
  assert.ok(running.includes("do not run in an ordinary `async` body"))
})

test("the public VIP uses the existing Promise bridge for both warning repairs", () => {
  const vip = read("docs/design/vips/0005-try-runs-effects.md")
  for (const [, repair] of repairs) assert.ok(vip.includes(repair), repair)
})

test("the exact printed bridges run the values while native await keeps the objects", () => {
  const witness = block(chapter("002-running"), "function asyncFiberValue(")
  const result = run(witness + "\nif (observed._tag !== 'Success' || observed.value[0] !== 7 || observed.value[1] !== 8 || nativeFiber !== fiber || nativeDeferred !== deferred) throw observed\n")
  assert.equal(result.status, 0, result.stderr)
})

test("the fibers guide keeps async warning repairs in the original Promise context", () => {
  const guide = read("docs/user/src/concurrency/047-fibers.md")
  for (const [, repair] of repairs) assert.ok(guide.includes(repair), repair + " is missing from the fibers guide")
})
test("fast-check: the printed Promise bridges preserve arbitrary completion values and native handles", () => {
  const witness = block(chapter("002-running"), "function asyncFiberValue(")
  fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }), (a, b) => {
    const source = witness.replace("Effect.succeed(7)", "Effect.succeed(" + a + ")")
      .replace("Deferred.succeed(deferred, 8)", "Deferred.succeed(deferred, " + b + ")")
    const result = run(source + "\nif (observed._tag !== 'Success' || observed.value[0] !== " + a + " || observed.value[1] !== " + b + " || nativeFiber !== fiber || nativeDeferred !== deferred) throw observed\n")
    assert.equal(result.status, 0, result.stderr)
  }), { seed: 46094610, numRuns: 20 })
})

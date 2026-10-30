import assert from "node:assert/strict"
import { test } from "node:test"
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

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Effect } from "effect"
import { chapter, read, run } from "./spec-witness.mjs"

const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

// VIP-5, amended 2026-10-31: a plain handler is plain code, so its throwing calls and throws are EK0401.
test("the plain-handler check is EK0401 and covers the handler's parameters", () => {
  const text = failures()
  const row = text.split("\n").find(line => line.startsWith("|") && line.includes("EK0403"))
  assert.match(row, /^\| In effect code, a call/)
  assert.match(text, /A call known to throw in a plain `catch` handler's parameters or body is `EK0401`\./)
  assert.match(text, /plain `catch` handlers \(parameters and body\)/)
})

test("the retained native activation witnesses preserve defects, laziness and the explicit bridge", () => {
  const result = run(read("docs/tools/fixtures/handler-initialization.ts") + `
import assert from "node:assert/strict"
for (const [program, defect] of [[defaultedHandler, "default"], [expressionHandler, "default"], [computedHandler, "key"]]) {
  const exit = Effect.runSyncExit(program)
  assert.deepEqual(exit.cause.reasons.map(r => [r._tag, r.defect]), [["Die", defect]])
}
const implicit = Effect.runSyncExit(implicitHandler)
assert.equal(implicit.cause.reasons[0]._tag, "Die")
assert.equal(implicit.cause.reasons[0].defect.name, "TypeError")
assert.equal(Effect.runSync(lazyHandler), 7)
const bridged = Effect.runSyncExit(bridgedHandler)
assert.deepEqual(bridged.cause.reasons.map(r => [r._tag, r.error]), [["Fail", "default"]])
`)
  assert.equal(result.status, 0, result.stderr)
})

test("fast-check: handler defaults stay lazy and an explicit bridge preserves failures", () => {
  fc.assert(fc.property(fc.string(), fc.integer(), (reason, value) => {
    let calls = 0
    const fail = () => { calls++; throw reason }
    const direct = Effect.catch(Effect.fail(undefined), (error = fail()) => Effect.succeed(value))
    assert.equal(calls, 0)
    const defect = Effect.runSyncExit(direct)
    assert.equal(calls, 1)
    assert.equal(defect._tag, "Failure")
    assert.deepEqual(defect.cause.reasons.map(r => [r._tag, r.defect]), [["Die", reason]])
    const supplied = Effect.catch(Effect.fail(1), (error = fail()) => Effect.succeed(value))
    assert.equal(Effect.runSync(supplied), value)
    assert.equal(calls, 1)
    const bridged = Effect.catch(Effect.fail(undefined), () => Effect.try({ try: fail, catch: error => error }))
    const failure = Effect.runSyncExit(bridged)
    assert.equal(calls, 2)
    assert.equal(failure._tag, "Failure")
    assert.deepEqual(failure.cause.reasons.map(r => [r._tag, r.error]), [["Fail", reason]])
  }), { seed: 50033, numRuns: 180 })
})

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

// VIP-5, amended 2026-10-31: a plain handler is plain code, so its throwing calls and throws are EK0401.
test("the plain-handler check is EK0401 and includes eager binding initialization", () => {
  const text = failures()
  const row = text.split("\n").find(line => line.startsWith("|") && line.includes("EK0403"))
  assert.match(row, /^\| In effect code, a call/)
  assert.match(row, /In a plain `catch` handler and other plain code, a call known to throw is `EK0401`/)
  assert.match(text, /A `throw` statement, or a call known to throw, in a plain `catch` handler's eager parameters or body is `EK0401`, including defaults, destructuring and computed binding keys/)
  assert.match(text, /nonthrowing parameters/)
  assert.match(text, /Merely defining a nested source function/)
})

test("the printed activation witnesses preserve defects, laziness and the explicit bridge", () => {
  const result = run(block(failures(), "const defaultedHandler =") + `
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

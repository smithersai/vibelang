import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("the plain-handler call check includes eager binding initialization", () => {
  const text = failures()
  const row = text.split("\n").find(line => line.startsWith("|") && line.includes("EK0403"))
  assert.match(row, /parameter\/default\/destructuring initialization/)
  assert.match(text, /computed binding keys/)
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

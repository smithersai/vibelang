import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("built-in thrown contracts use the selected signature's entire admitted domain", () => {
  for (const name of ["003-failures", "900-appendices"]) {
    const text = chapter(name)
    assert.match(text, /selected (?:declaration\/overload|signature).*receiver and parameter types/)
    assert.match(text, /safe literal.*does not.*(?:erase|replace|change)/)
  }
})

test("padding uses ToLength rather than repeat's count validation", () => {
  const text = chapter("003-failures")
  assert.doesNotMatch(text, /`repeat` and `padStart` counts/)
  assert.match(text, /`padStart` and `padEnd`.*`ToLength`/)
  assert.match(text, /padding.*`never`/)
})

test("the printed built-in counterpart preserves successes and captured range failures", () => {
  const source = block(chapter("003-failures"), "const builtins =")
  const result = run(source + `
import assert from "node:assert/strict"
import { Exit } from "effect"
const completed = Effect.runSyncExit(builtins)
assert.equal(Exit.isSuccess(completed), true)
assert.deepEqual(completed.value, [["a"], "x", "1.50", "xxx"])
for (const call of [
  () => "x".repeat(-1),
  () => "x".repeat(Infinity),
  () => (1.5).toFixed(101)
]) {
  const failed = Effect.runSyncExit(Effect.try(call))
  assert.equal(Exit.isFailure(failed), true)
  assert.equal(failed.cause.reasons.some(r => r._tag === "Fail" && r.error.cause instanceof RangeError), true)
}
for (const method of ["padStart", "padEnd"]) {
  for (const n of [-Infinity, -1, 0, NaN, 1, 3]) {
    const padded = Effect.runSyncExit(Effect.sync(() => "x"[method](n, "0")))
    assert.equal(Exit.isSuccess(padded), true)
    assert.equal(padded.value, n === 3 ? (method === "padStart" ? "00x" : "x00") : "x")
  }
}
`)
  assert.equal(result.status, 0, result.stderr)
})


test("VIP-4 publishes full declared domains and the padding exception", () => {
  const text = process.env.SPEC_VIP4 ? readFileSync(process.env.SPEC_VIP4, "utf8") : read("docs/design/vips/0004-throw.md")
  assert.match(text, /full admitted receiver and parameter types/)
  assert.match(text, /Safe literals or local range proofs/)
  assert.match(text, /padStart.*padEnd.*ToLength/)
})

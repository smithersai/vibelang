import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("both loop operands retain their uninitialized source head bindings", () => {
  const text = running()
  assert.match(text, /head bindings.*uninitialized/)
  assert.match(text, /right-hand operand/)
})

test("outward-return checks cover each item's binding initialization", () => {
  const text = running()
  for (const code of ["EK1904", "EK2002"]) {
    const row = text.split("\n").find(line => line.startsWith("|") && line.includes(code))
    assert.match(row, /head binding initialization or the body/)
  }
})

test("the printed loop head counterparts preserve TDZ after their iterations", () => {
  const result = run(block(running(), "const concurrentHeadScope =") + `
import assert from "node:assert/strict"
import { Exit } from "effect"
assert.equal(Effect.runSync(limitReturn()), 7)
for (const program of [concurrentHeadScope, streamHeadScope]) {
  const observed = await Effect.runPromiseExit(program)
  assert.equal(Exit.isFailure(observed), true)
  assert.deepEqual(observed.cause.reasons.map(r => r._tag), ["Die"])
  assert.equal(observed.cause.reasons[0].defect.name, "ReferenceError")
}
`)
  assert.equal(result.status, 0, result.stderr)
})

test("native name, array and object heads all retain separate TDZ cells", () => {
  const controls = [
    () => { let read = () => 0; let x = 42; for (let x of (read = () => x, [1])) {} return read() },
    () => { let read = () => 0; let x = 42; for (const x of (read = () => x, [1])) {} return read() },
    () => { let read = () => 0; let x = 42; for (let [x] of (read = () => x, [[1]])) {} return read() },
    () => { let read = () => 0; let x = 42; for (const { x } of (read = () => x, [{ x: 1 }])) {} return read() }
  ]
  for (const program of controls) assert.throws(program, ReferenceError)
})


test("the limit is evaluated before the uninitialized RHS head environment exists", () => {
  assert.match(running(), /limit is evaluated before entering this head environment/)
  const result = run(block(running(), "const concurrentHeadScope =") + `
import assert from "node:assert/strict"
assert.equal(Effect.runSync(limitBeforeHead), 1)
`)
  assert.equal(result.status, 0, result.stderr)
})

test("the accepted loop VIPs publish head scope and initialization checks", () => {
  const concurrent = read("docs/design/vips/0019-for-concurrent.md")
  const stream = read("docs/design/vips/0020-for-try.md")
  for (const text of [concurrent, stream]) {
    assert.match(text, /uninitialized head bindings/)
    assert.match(text, /head binding initialization and body/)
  }
  assert.match(concurrent, /limit before entering/)
})

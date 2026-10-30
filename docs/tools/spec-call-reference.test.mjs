import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")
const counterpart = () => block(running(), "function total(o: Calc)")
const fixture = `
import { Effect } from "effect"
import assert from "node:assert/strict"
type Calc = { base: number; add(x: number, y: number): number }
const o: Calc = { base: 2, add(x, y) { return this.base + x + y } }
const n = () => 1
`

test("the printed method call ignores mutable and source-shadowed invocation helpers", () => {
  for (const [setup, cleanup] of [
    ['const original = globalThis.Reflect.apply; const a = () => Effect.sync(() => { globalThis.Reflect.apply = () => 999; return 7 })', 'globalThis.Reflect.apply = original'],
    ['const Reflect = { apply: () => 321 }; const a = () => Effect.succeed(7)', '']
  ]) {
    const result = run(fixture + setup + "\n" + counterpart() + `
try { assert.equal(Effect.runSync(total(o)), 19) } finally { ` + cleanup + ` }
`)
    assert.equal(result.status, 0, result.stderr)
  }
})

test("the printed call keeps the native receiver, reference timing and noncallable error", () => {
  const result = run(fixture + `
const trace: string[] = []
const originalAdd = o.add
Object.defineProperty(originalAdd, "call", { get() { throw new Error("own call getter") } })
Object.defineProperty(o, "add", { configurable: true, get() { trace.push("get"); return originalAdd } })
const a = () => Effect.sync(() => {
  trace.push("argument")
  Object.defineProperty(o, "add", { configurable: true, value: () => 999 })
  return 7
})
` + counterpart() + `
assert.equal(Effect.runSync(total(o)), 19)
assert.deepEqual(trace, ["get", "argument"])
const bad: Calc = { base: 2, add: 1 as unknown as Calc["add"] }
function reference(o: Calc) {
  return Effect.gen(function* () { return o.add(yield* a(), n() === 1 ? 10 : 0) })
}
const expected = Effect.runSyncExit(reference(bad)).cause.reasons[0].defect
const exit = Effect.runSyncExit(total(bad))
assert.equal(exit._tag, "Failure")
assert.equal(exit.cause.reasons[0]._tag, "Die")
assert.equal(exit.cause.reasons[0].defect.name, expected.name)
assert.equal(exit.cause.reasons[0].defect.message, expected.message)
`)
  assert.equal(result.status, 0, result.stderr)
})

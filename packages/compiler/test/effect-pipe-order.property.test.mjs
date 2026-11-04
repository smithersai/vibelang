import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, require, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/alchemy-custom-stage-order.txt", import.meta.url), "utf8")
const { Effect } = require("effect")

test("custom pipeline stages are all constructed before any stage is applied", { skip, timeout: 120000 }, async t => {
  const { original, changed, text } = await migrationPair(t, source, "EK4502")
  assert.equal((text.match(/\.pipe\(/g) || []).length, 1, "only the receiver-sensitive method keeps its native pipe")
  assert.match(text, /\.pipe\(holder\.stage\)/)
  const observe = (f, n) => {
    const trace = []
    const program = f(trace, n)
    const cold = [...trace]
    const value = Effect.runSync(program)
    const after = [...trace]
    const again = Effect.runSync(program)
    return { cold, value, after, again, trace }
  }
  fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), n => {
    for (const name of ["pipeline", "mixed", "capture", "method", "runner", "retryOptions", "spanOptions"]) {
      assert.deepEqual(observe(changed[name], n), observe(original[name], n), name)
    }
  }), { seed: 312305, numRuns: 100 })
})

test("property: generated custom stage lists retain factory order around library stages", { skip, timeout: 120000 }, async t => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 2, max: 5 }), fc.boolean(), fc.boolean(), async (count, before, after) => {
    const stages = [
      ...(before ? ["Effect.map((n: number) => n + 1)"] : []),
      ...Array.from({ length: count }, (_, i) => "stage(trace, " + JSON.stringify("stage:" + i) + ")"),
      ...(after ? ["Effect.map((n: number) => n * 2)"] : [])
    ]
    const input = source.slice(0, source.indexOf("export const pipeline")) +
      "export const pipeline = (trace: string[], value: number) => Effect.sync(() => { trace.push('run'); return value }).pipe(" + stages.join(", ") + ")\n"
    const { original, changed } = await migrationPair(t, input, "EK4502")
    for (const n of [-1, 0, 7]) {
      const left = [], right = []
      const a = original.pipeline(left, n), b = changed.pipeline(right, n)
      assert.deepEqual(right, left, "construction trace")
      assert.equal(Effect.runSync(b), Effect.runSync(a))
      assert.deepEqual(right, left, "execution trace")
    }
  }), { seed: 312306, numRuns: 12 })
})

test("ordered catch and provide stages keep mapping, recovery and held fallback programs", { skip, timeout: 120000 }, async t => {
  const { original, changed } = await migrationPair(t, source, "EK4502")
  const observe = (module, name, fails, n) => {
    const trace = []
    const program = module[name](trace, fails, n)
    const cold = [...trace]
    const value = Effect.runSync(program)
    const after = [...trace]
    const held = Effect.isEffect(value)
    const result = held ? Effect.runSync(value) : value
    return { cold, after, held, result, trace }
  }
  fc.assert(fc.property(fc.boolean(), fc.integer({ min: -100, max: 100 }), (fails, n) => {
    for (const name of ["ordered", "held"]) {
      assert.deepEqual(observe(changed, name, fails, n), observe(original, name, fails, n), name)
    }
    const held = observe(changed, "held", true, n)
    assert.deepEqual(held.after, [], "fallback program stays cold")
    assert.equal(held.held, true)
    assert.deepEqual(held.trace, ["held"])
  }), { seed: 312322, numRuns: 100 })
})

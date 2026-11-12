import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { propertySlice, slicedCheck } from "./testing/property-slice.mjs"
import { prepareParallelProperty } from "./testing/parallel-property.mjs"
import { pass, failure } from "./testing/parallel-property-fixture.mjs"
const fc = createRequire(new URL("../packages/runtime/package.json", import.meta.url))("fast-check")
const module = new URL("./testing/parallel-property-fixture.mjs", import.meta.url)

test("sample partitions retain every seeded generated input once", async () => {
  for (const count of [2, 3, 4, 8]) {
    const arbitrary = fc.record({ value: fc.integer(), text: fc.string() })
    const options = { seed: 27121, numRuns: 61 }
    const original = []
    await fc.assert(fc.asyncProperty(arbitrary, value => { original.push(value) }), options)
    const actual = []
    for (let index = 0; index < count; index++) {
      const owned = []
      await fc.assert(fc.asyncProperty(arbitrary, slicedCheck(value => { owned.push(value) }, { index, count })), options)
      assert.deepEqual(owned, original.filter((_, i) => i % count === index))
      actual.push(...owned)
    }
    assert.deepEqual(actual.map(JSON.stringify).sort(), original.map(JSON.stringify).sort())
  }
})

test("an assigned failing sample keeps the original counterexample and shrinking", async () => {
  const arbitrary = fc.integer({ min: 0, max: 1000 })
  const check = x => { assert.ok(x < 100) }
  const options = { seed: 54321, numRuns: 120 }
  const before = await fc.check(fc.asyncProperty(arbitrary, check), options)
  const after = await fc.check(fc.asyncProperty(arbitrary, slicedCheck(check, { index: 0, count: 4 })), options)
  for (const key of ["failed", "counterexample", "counterexamplePath", "numShrinks"])
    assert.deepEqual(after[key], before[key], key)
})

test("worker property slices keep sampling and evaluate only owned indices", async () => {
  const options = { arbitraries: [fc.integer({ min: 0, max: 1000 })], module, seed: 54321, numRuns: 21 }
  const before = fc.check(fc.property(...options.arbitraries, failure), options)
  for (let index = 0; index < 3; index++) {
    const prepared = await prepareParallelProperty(fc, { ...options, oracle: pass, exportName: "pass",
      env: { VIBELANG_PROPERTY_SLICE: (index + 1) + "/3" } })
    assert.equal(prepared.samples.length, 21)
    prepared.assert()
  }
  const prepared = await prepareParallelProperty(fc, { ...options, oracle: failure, exportName: "failure",
    env: { VIBELANG_PROPERTY_SLICE: "1/3" } })
  const after = prepared.check()
  for (const key of ["failed", "counterexample", "counterexamplePath", "numShrinks"])
    assert.deepEqual(after[key], before[key], key)
})

test("invalid or partial slice values fail instead of silently losing samples", () => {
  for (const value of ["0/2", "3/2", "1/0", "1/1025", "1", "1/2/3", "-1/2", "1.5/3"])
    assert.throws(() => propertySlice({ VIBELANG_PROPERTY_SLICE: value }), /must be i\/n/)
  assert.deepEqual(propertySlice({}), { index: 0, count: 1 })
})

test("the public property protocol retains sync/async examples, sample ownership and shrinking", async () => {
  const { sliceFastCheckProperty } = await import("./testing/property-slice.mjs")
  for (const async of [false, true]) {
    const factory = async ? fc.asyncProperty : fc.property
    const options = { seed: 54321, numRuns: 33, examples: [[7], [9]] }
    const original = []
    await fc.assert(factory(fc.integer(), x => { original.push(x) }), options)
    const union = []
    for (let index = 0; index < 4; index++) {
      const actual = []
      await fc.assert(sliceFastCheckProperty(factory(fc.integer(), x => { actual.push(x) }), { index, count: 4 }), options)
      assert.deepEqual(actual, original.filter((_, i) => i % 4 === index))
      union.push(...actual)
    }
    assert.deepEqual(union.sort((a,b)=>a-b), original.sort((a,b)=>a-b))
    const fail = x => { assert.ok(x < 100) }
    const before = await fc.check(factory(fc.integer({min:0,max:1000}), fail), options)
    const after = await fc.check(sliceFastCheckProperty(factory(fc.integer({min:0,max:1000}), fail), {index:2,count:4}), options)
    for (const key of ["failed", "counterexample", "counterexamplePath", "numShrinks"])
      assert.deepEqual(after[key], before[key], key)
  }
})

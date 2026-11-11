import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { inspect } from "node:util"
import { prepareParallelProperty } from "./testing/parallel-property.mjs"
import * as oracle from "./testing/parallel-property-fixture.mjs"
const require = createRequire(new URL("../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const module = new URL("./testing/parallel-property-fixture.mjs", import.meta.url)
for (const name of ["pass", "failure", "throws", "reordered", "pair", "triple"]) {
  test("parallel properties retain sampling, failures and shrinking: " + name, async () => {
    const arbitraries = name === "pair"
      ? [fc.record({ value: fc.integer({ min: 0, max: 1000 }) }), fc.option(fc.constantFrom("ok", "bad"), { nil: undefined })]
      : name === "triple"
        ? [fc.uniqueArray(fc.record({ name: fc.constantFrom("a", "b", "c", "d"), value: fc.integer() }), { selector: m => m.name, minLength: 1, maxLength: 4 }),
          fc.option(fc.tuple(fc.nat(3), fc.constantFrom("readonly", "optional"))), fc.boolean()]
        : [fc.integer({ min: 0, max: 1000 })]
    for (const concurrency of [1, 2, 3, 4]) {
      const options = { seed: 54321, numRuns: 120 }
      const samples = []
      fc.assert(fc.property(...arbitraries, (...inputs) => { samples.push(inputs) }), options)
      const before = fc.check(fc.property(...arbitraries, oracle[name]), options)
      const parallel = await prepareParallelProperty(fc, {
        arbitraries, oracle: oracle[name], module, exportName: name, ...options, concurrency
      })
      const after = parallel.check()
      assert.deepEqual(parallel.samples, samples)
      for (const key of ["failed", "counterexample", "counterexamplePath", "numRuns", "numShrinks", "numSkips"])
        assert.deepEqual(after[key], before[key], name + " " + concurrency + " " + key)
      if (name === "pass") parallel.assert()
      else assert.throws(() => parallel.assert(), /Property failed/)
    }
  })
}
test("worker import and premature exit fail the property", async () => {
  const options = { arbitraries: [fc.constant(7)], oracle: oracle.pass, seed: 1, numRuns: 3 }
  await assert.rejects(prepareParallelProperty(fc, { ...options, module: new URL("./testing/absent-oracle.mjs", import.meta.url) }), /Cannot find module/)
  await assert.rejects(prepareParallelProperty(fc, { ...options, module, exportName: "exit" }), /worker exited/)
  await assert.rejects(prepareParallelProperty(fc, { ...options, module, concurrency: 0 }), /concurrency must be positive/)
})

test("workers evaluate every seeded sample once within the concurrency bound", async t => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const directory = mkdtempSync(join(tmpdir(), "parallel-property-"))
  const previous = process.env.PARALLEL_PROPERTY_TRACE
  t.after(() => {
    if (previous === undefined) delete process.env.PARALLEL_PROPERTY_TRACE
    else process.env.PARALLEL_PROPERTY_TRACE = previous
    rmSync(directory, { recursive: true, force: true })
  })
  for (const numRuns of [80, 120, 150, 200, 300]) {
    const trace = join(directory, numRuns + ".jsonl")
    process.env.PARALLEL_PROPERTY_TRACE = trace
    const prepared = await prepareParallelProperty(fc, {
      arbitraries: [fc.record({ value: fc.integer(), name: fc.string() }), fc.option(fc.boolean(), { nil: undefined })],
      oracle: oracle.counted, module, exportName: "counted", seed: 800081, numRuns, concurrency: 4
    })
    prepared.assert()
    const records = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse)
    assert.equal(records.length, numRuns)
    assert.deepEqual(records.map(r => JSON.stringify(r.inputs)).sort(), prepared.samples.map(s => JSON.stringify(s)).sort())
    assert.equal(new Set(records.map(r => r.threadId)).size, 4)
  }
})

for (const name of ["asyncPass", "asyncFailure", "asyncThrows"]) {
  test("asynchronous predicates retain sampling, failures and shrinking: " + name, async () => {
    const arbitraries = [fc.integer({ min: 0, max: 1000 })]
    const options = { seed: 131013, numRuns: 40 }
    for (const concurrency of [1, 4]) {
      const before = await fc.check(fc.asyncProperty(...arbitraries, oracle[name]), options)
      const parallel = await prepareParallelProperty(fc, {
        arbitraries, oracle: oracle[name], module, exportName: name, ...options, concurrency, asyncPredicate: true
      })
      const after = await parallel.check()
      for (const key of ["failed", "counterexample", "counterexamplePath", "numRuns", "numShrinks", "numSkips"])
        assert.deepEqual(after[key], before[key], name + " " + key)
      if (name === "asyncPass") await parallel.assert()
      else await assert.rejects(() => parallel.assert(), /Property failed/)
    }
  })
}
test("a Promise cannot silently change a synchronous property's contract", async () => {
  const prepared = await prepareParallelProperty(fc, {
    arbitraries: [fc.constant(7)], oracle: oracle.asyncPass, module, exportName: "asyncPass", seed: 1, numRuns: 3
  })
  assert.throws(() => prepared.assert(), /Property failed/)
})

test("function-valued choices keep their original generator and shrinking through a lossless index codec", async () => {
  const arbitraries = [fc.constantFrom(...oracle.writers), fc.integer({ min: 0, max: 1000 })]
  const options = { seed: 16101, numRuns: 120 }
  const before = fc.check(fc.property(...arbitraries, oracle.coded), options)
  const prepared = await prepareParallelProperty(fc, {
    arbitraries, oracle: oracle.coded, module, exportName: "codedWorker", ...options,
    encode: ([write, n]) => [oracle.writers.indexOf(write), n]
  })
  const after = prepared.check()
  for (const key of ["failed", "counterexample", "counterexamplePath", "numRuns", "numShrinks", "numSkips"])
    assert.deepEqual(after[key], before[key], key)
})
test("worker assertion diagnostics retain complete arrays and strings without shrinking", async () => {
  const prepared = await prepareParallelProperty(fc, {
    arbitraries: [fc.constant(1)], oracle: oracle.largeFailure, module, exportName: "largeFailure", seed: 1, numRuns: 1
  })
  assert.throws(() => prepared.assert(), error => {
    const output = inspect(error, { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, customInspect: false })
    return output.includes("ARRAY_END_WITNESS") && output.includes("STRING_END_WITNESS")
  })
})

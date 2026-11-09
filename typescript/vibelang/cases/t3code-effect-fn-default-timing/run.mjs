import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Stream } from "effect"
import * as native from "./out/main.js"
import * as twin from "./out/twin.js"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
async function observe(api, weights, supplied, migrated) {
  api.reset()
  const program = (migrated ? api.migratedWeights : api.make)(weights, supplied)
  const atCall = api.snapshot()
  const first = await Effect.runPromise(program), second = await Effect.runPromise(program)
  return { atCall, first, second, after: api.snapshot() }
}
await fc.assert(fc.asyncProperty(
  fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 3, maxLength: 3 }),
  fc.option(fc.integer({ min: -10, max: 10 }), { nil: undefined }),
  async (weights, supplied) => {
    for (const migrated of [false, true]) assert.deepEqual(await observe(native, weights, supplied, migrated), await observe(twin, weights, supplied, migrated))
  }
), { numRuns: 100 })
for (const api of [native, twin]) {
  api.reset()
  for (const argument of [[], [undefined], [9]]) {
    api.change(1); const p = api.fromState(...argument); api.change(2)
    assert.equal(await Effect.runPromise(p), argument[0] ?? 1)
    api.change(3); assert.equal(await Effect.runPromise(p), argument[0] ?? 1)
  }
  const input = { branch: "first" }, p = api.fromArgument(input)
  input.branch = "second"; assert.equal(await Effect.runPromise(p), "first")
  input.branch = "third"; assert.equal(await Effect.runPromise(p), "first")
  const allocated = api.fresh(), a = await Effect.runPromise(allocated)
  assert.equal(a.seen, 1); assert.equal(await Effect.runPromise(allocated), a); assert.equal(a.seen, 2)
  assert.notEqual(await Effect.runPromise(api.fresh()), a)
  const array = api.freshArray(), values = await Effect.runPromise(array)
  assert.equal(await Effect.runPromise(array), values); assert.equal(values.length, 2)
  assert.notEqual(await Effect.runPromise(api.freshArray()), values)
  api.reset(); const effect = api.effectValue(); assert.equal(api.snapshot().counter, 1)
  assert.equal(await Effect.runPromise(effect), 1); assert.equal(await Effect.runPromise(effect), 1)
  api.reset(); const stream = api.generator.values(); assert.equal(api.snapshot().counter, 3)
  assert.deepEqual(Array.from(await Effect.runPromise(Stream.runCollect(stream))), [3, 4])
  assert.deepEqual(Array.from(await Effect.runPromise(Stream.runCollect(stream))), [3, 5])
  api.change(1); const delayed = api.migratedState(); api.change(2)
  assert.equal(await Effect.runPromise(delayed), 2)
  api.change(3); assert.equal(await Effect.runPromise(delayed), 3)
  const oldInput = { branch: "first" }, migrated = api.migrated(oldInput)
  oldInput.branch = "second"; const first = await Effect.runPromise(migrated)
  oldInput.branch = "third"; const second = await Effect.runPromise(migrated)
  assert.equal(first.resolved, "second"); assert.equal(second.resolved, "third")
  assert.notEqual(first.allocated, second.allocated)
  assert.equal(first.allocated.seen, 1); assert.equal(second.allocated.seen, 1)
}
console.log("default timing matches TypeScript")

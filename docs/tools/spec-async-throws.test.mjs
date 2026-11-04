import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Effect, Exit } from "effect"
import { chapter, read, run } from "./spec-witness.mjs"

const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("async declarations follow source callback contracts without synchronous throws", () => {
  const text = failures()
  assert.match(text, /nongenerator.*async.*synchronous thrown type.*never/)
  // VIP-4's accepted foreign-only contracts are published; no fallback to
  // source @rethrows or inferred synchronous async throws remains.
  assert.match(text, /body, parameter\/default initialization and callback throws reject its Promise/)
  assert.match(text, /declarations, methods and arrows, but not async generators/)
  assert.match(text, /callback parameters follow their written callable signatures/)
  assert.match(text, /source `@rethrows` tag is `EK0406`/)
  assert.match(text, /Declaration output carries callee `@throws \{never\}`/)
  assert.match(text, /A returned callable keeps its own thrown contract/)
  assert.match(text, /Promise-returning plain function.*synchronously/)
})

test("the native async and plain Promise witnesses keep different exception boundaries", () => {
  const result = run(read("docs/tools/fixtures/async-contract-boundaries.ts") + `
import assert from "node:assert/strict"
import { Exit } from "effect"
const rejected = await Effect.runPromiseExit(checkedAsync)
assert.equal(Exit.isFailure(rejected), true)
assert.equal(rejected.cause.reasons[0].error, "callback")
const synchronous = Effect.runSyncExit(checkedPlain)
assert.equal(Exit.isFailure(synchronous), true)
assert.equal(synchronous.cause.reasons[0].error, "callback")
assert.throws(() => invokePlain(() => { throw "callback" }), e => e === "callback")
const promise = invokeAsync(() => { throw "callback" })
assert.equal(promise instanceof Promise, true)
await assert.rejects(promise, e => e === "callback")
`)
  assert.equal(result.status, 0, result.stderr)
})


test("the Creating Effects guide limits synchronous rethrows to synchronous invocation", () => {
  const text = read("docs/user/src/getting-started/005-creating-effects.md")
  // VIP-4, amended 2026-10-31: only a `.ts` function's synchronous invocation rethrows; `async` rejects.
  assert.match(text, /For synchronous invocation of a `\.ts` function, `@rethrows f` adds `f`'s thrown type/)
  assert.match(text, /An `async` function's `throw` rejects its Promise\./)
})

test("fast-check: native async declarations, arrows and methods reject callback failures", async () => {
  const invokers = [
    async function declared(f) { return f() },
    async f => f(),
    f => ({ async method() { return f() } }).method(),
    f => (async function declared(value = f()) { return value })(),
    f => (async (value = f()) => value)(),
    f => ({ async method(value = f()) { return value } }).method(),
  ]
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: invokers.length - 1 }), fc.jsonValue(), async (form, reason) => {
    const invoke = invokers[form]
    let calls = 0
    const callback = () => { calls++; throw reason }
    const promise = invoke(callback)
    assert.ok(promise instanceof Promise)
    assert.equal(calls, 1)
    const rejected = await promise.then(() => assert.fail("callback failure fulfilled"), error => error)
    assert.equal(rejected, reason)
    const bridged = await Effect.runPromiseExit(Effect.tryPromise({ try: () => invoke(callback), catch: error => error }))
    assert.ok(Exit.isFailure(bridged))
    assert.equal(bridged.cause.reasons[0]._tag, "Fail")
    assert.equal(bridged.cause.reasons[0].error, reason)
    const plain = () => Promise.resolve(callback())
    assert.throws(plain, error => error === reason)
    const synchronous = Effect.runSyncExit(Effect.try({ try: plain, catch: error => error }))
    assert.ok(Exit.isFailure(synchronous))
    assert.equal(synchronous.cause.reasons[0].error, reason)
  }), { seed: 4007, numRuns: 180 })
})

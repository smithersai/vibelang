import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("async declarations follow source callback contracts without synchronous throws", () => {
  const text = failures()
  assert.match(text, /nongenerator.*async.*synchronous thrown type.*never/)
  if (text.includes("A written `@throws` or `@rethrows` tag in a `.vibe` file is `EK0406`")) {
    assert.doesNotMatch(text, /A source `@rethrows` parameter still admits/)
    assert.match(text, /callback parameters follow their written callable signatures/)
    assert.match(text, /source `@rethrows` tag is `EK0406`/)
  } else {
    // The older published spec still allows source rethrows. Keep its guard
    // until the source-only reconciliation is folded by the spec lander.
    assert.match(text, /parameter.*@throws \{unknown\}/)
    assert.match(text, /omit.*synchronous.*@rethrows/)
    assert.match(text, /shared type alias/)
  }
  assert.match(text, /Promise-returning plain function.*synchronously/)
})

test("the printed async and plain Promise producers keep different exception boundaries", () => {
  const result = run(block(failures(), "async function invokeAsync") + `
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

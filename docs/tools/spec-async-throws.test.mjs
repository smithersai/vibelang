import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("async declarations preserve throwing-callback admission without synchronous rethrows", () => {
  const text = failures()
  assert.match(text, /nongenerator.*async.*synchronous thrown type.*never/)
  assert.match(text, /parameter.*@throws \{unknown\}/)
  assert.match(text, /omit.*synchronous.*@rethrows/)
  assert.match(text, /shared type alias/)
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
  assert.match(text, /For synchronous invocation/)
  assert.match(text, /without active synchronous/)
  assert.match(text, /result type alone/)
})

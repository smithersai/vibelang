import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Script } from "node:vm"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"
test("the Promise analogy uses native syntax and async-match owns its jump rule", () => {
  const running = process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")
  assert.doesNotMatch(running, new RegExp("is "+String.fromCharCode(96)+"async do"))
  assert.doesNotMatch(running, /async do.*return 1/)
  assert.ok(running.includes("(async () => {"))
  const match = process.env.SPEC_MATCH ? readFileSync(process.env.SPEC_MATCH, "utf8") : chapter("004-match")
  assert.doesNotMatch(match, new RegExp("As in TC39.s "+String.fromCharCode(96)+"async do"+String.fromCharCode(96)))
  assert.match(match, /VIP-7.*return|return.*VIP-7/)
})
test("async do is not native syntax, while the invoked async arrow resolves its return", async () => {
  assert.throws(() => new Script("async do { 1 }"), SyntaxError)
  assert.throws(() => new Script("async do { return 1 }"), SyntaxError)
  assert.equal(await new Script("(async () => { return 1 })()").runInThisContext(), 1)
})

import assert from "node:assert/strict"
import { Effect } from "effect"
import { take, test, inMatch } from "./out/main.js"
import { takeNative } from "./out/native.js"

const results = []
for (const input of [null, {}, {child:{}}, {child:{items:[]}}, {child:{items:[7]}}, {child:{items:[1,2]}}]) {
  for (const f of [take,inMatch]) {
    const got = Effect.runSyncExit(Effect.sync(() => f(input)))
    const want = Effect.runSyncExit(Effect.sync(() => takeNative(input)))
    assert.deepEqual(got,want)
    results.push(got)
  }
  assert.equal(test(input), takeNative(input) !== "missing")
}
for (const f of [take,test,inMatch,takeNative]) {
  const reads = []
  const subject = { get child() { reads.push("child"); return {get items() { reads.push("items"); return [7] }} }}
  assert.equal(f(subject),f===test?true:7)
  assert.deepEqual(reads,["child","items"])
}
console.log("nested subject identity and native Exits agree")

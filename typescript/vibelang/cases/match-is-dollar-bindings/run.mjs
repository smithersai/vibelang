import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"

for (const [name,f] of Object.entries(actual)) {
  for (const subject of [null,{}, {id:7}]) {
    const found = subject !== null && "id" in subject
    const expected = name==="arrow" ? found : found ? name==="mutable" ? 9 : subject.id : 0
    assert.deepEqual(Effect.runSyncExit(Effect.sync(()=>f(subject))),Effect.runSyncExit(Effect.succeed(expected)))
  }
  let reads=0
  const subject = {get id(){reads++;return 7}}
  assert.equal(f(subject),name==="arrow"?true:name==="mutable"?9:7)
  assert.equal(reads,1)
}
console.log("dollar binding names and native Exits agree")

import assert from "node:assert/strict"
import test from "node:test"
import {block,read,run} from "./spec-witness.mjs"
test("the public schema-error decision does not promise automatic JSON conversion",()=>{
  const source=read("docs/design/vips/0029-schema-errors.md")
  for(const text of ["encoding is not JSON serialization", "no implicit wire conversion",
    "Transport compatibility follows their encoded representations"])
    assert.ok(source.includes(text),text)
  assert.ok(!source.includes("const json = try Schema.encodeEffect"))
  const result=run(block(source,"const jsonTransportExit")+`
if(typeof encodedBigCount.count !== "bigint") throw new Error("wrong encoded count")
if(jsonTransportExit._tag !== "Failure" || jsonTransportExit.cause.reasons[0]._tag !== "Fail" || !(jsonTransportExit.cause.reasons[0].error instanceof TypeError)) throw new Error("wrong JSON failure")
if(encodedJsonCount.count !== "1" || jsonRoundTripExit._tag !== "Success" || jsonRoundTripExit.value.count !== 1n) throw new Error("wrong round trip")
`)
  assert.equal(result.status,0,result.stdout+result.stderr)
})

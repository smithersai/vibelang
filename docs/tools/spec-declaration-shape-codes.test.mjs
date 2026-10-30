import assert from "node:assert/strict"
import test from "node:test"
import {block,chapter,read,run} from "./spec-witness.mjs"
test("incomplete declaration diagnostics preserve admission and ambient recovery priority",()=>{
 const service=chapter("005-services"),data=chapter("006-data"),catalog=chapter("900-appendices")
 for(const [code,source,vip] of [
  ["EK0906",service,"0009-service-declarations"],["EK0907",service,"0009-service-declarations"],
  ["EK1503",data,"0015-schema-declarations"],["EK1604",data,"0016-data-declarations"]
 ]) {
  assert.ok(source.includes(code),code)
  assert.ok(catalog.includes("| `"+code+"` |"),code+" catalog")
  assert.ok(read("docs/design/vips/"+vip+".md").includes(code),code+" public rule")
 }
 assert.ok(service.includes("ahead of the same declaration's missing-body recovery"))
 assert.ok(catalog.includes("Recovery does not admit another declaration form"))
 assert.ok(data.includes("or remove the bodyless `error` and `schema error` forms"))
 const result=run(block(data,"const declarationRepairExit")+`
if (!Exit.isSuccess(declarationRepairExit) || JSON.stringify(declarationRepairExit.value)!==JSON.stringify([0,0,"ok","Allowed","AlsoAllowed",0])) throw new Error("changed declaration admission")
`)
 assert.equal(result.status,0,result.stdout+result.stderr)
})

import assert from "node:assert/strict"
import test from "node:test"
import {block,chapter,read,run} from "./spec-witness.mjs"
test("computed-key admission and execution follow the actual native declaration counterpart",()=>{
 const data=chapter("006-data"),grammar=chapter("900-appendices")
 for(const text of ["runtime object-literal grammar","type-member restrictions do not apply",
   "computed key expressions are type checked and erased","rather than a fabricated type literal"])
  assert.ok(data.includes(text),text)
 assert.ok(grammar.includes("native TypeScript type-member checks and are erased"))
 assert.ok(chapter("003-failures").includes("field keys instead use the runtime object literal admission"))
 assert.ok(!chapter("003-failures").includes("Field keys follow TypeScript object types, as in"))
 for(const vip of ["0015-schema-declarations","0016-data-declarations","0029-schema-errors"])
  assert.ok(read("docs/design/vips/"+vip+".md").includes("computed"),vip)
 for(const [marker,expected] of [
  ["const dataKeyExit",[0,1,"read","eager",0]],
  ["const runtimeKeysExit",[3,1,2,false,true,7]]
 ]) {
  const variable=marker.slice("const ".length)
  const result=run(block(data,marker)+`
if(!Exit.isSuccess(${variable})||JSON.stringify(${variable}.value)!==JSON.stringify(${JSON.stringify(expected)})) throw new Error("wrong native key counterpart")
`)
  assert.equal(result.status,0,result.stdout+result.stderr)
 }
})

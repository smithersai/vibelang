import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity } from "./api-identity.mjs"

const require=createRequire(new URL("../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-transparent-type-reexport.json",import.meta.url),"utf8"))

function compare({changed=false,changedDoc=false,doc="The input.",name="File",chain=false}={}) {
  const root=mkdtempSync(join(tmpdir(),"api-transparent-reexport-"))
  try {
    for(const side of ["before","after"]) {
      const dir=join(root,side);mkdirSync(dir)
      writeFileSync(join(dir,"package.json"),JSON.stringify({type:"module",exports:{"./Input":{types:"./Input.d.ts"},"./Package":{types:"./Package.d.ts"}}}))
      const input=`/** ${changedDoc&&side==="after"?"Changed documentation.":doc} */ export interface ${name} {readonly path: ${changed&&side==="after"?"number":"string"}}`
      writeFileSync(join(dir,"Input.d.ts"),side==="before"?input:`export type {${name}} from "./Input.vibe.platform.js";`)
      if(side==="after") {
        writeFileSync(join(dir,"Input.vibe.platform.d.ts"),chain?`export type {${name}} from "./internal.js";`:input)
        if(chain)writeFileSync(join(dir,"internal.d.ts"),input)
      }
      writeFileSync(join(dir,"Target.d.ts"),'import type * as Input from "./Input.js"; export declare const TypeId: unique symbol; export interface AnyTarget {readonly [TypeId]:true}')
      writeFileSync(join(dir,"Package.d.ts"),corpus.factory.replaceAll("Input.File","Input."+name))
    }
    return compareApiIdentity(ts,join(root,"before"),join(root,"after"),{compilerOptions:{lib:["lib.es5.d.ts"],types:[]}})
  } finally {rmSync(root,{recursive:true,force:true})}
}

test("an unused type import does not break a factory when its dependency only gains a re-export",()=>{
  const result=compare()
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,true,JSON.stringify(result))
})
test("transparent re-export chains retain the exported factory's identity",()=>{
  const result=compare({chain:true})
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,true,JSON.stringify(result))
})
test("a changed field behind the re-export still changes the factory's API",()=>{
  const result=compare({changed:true})
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,false)
  assert.ok(result.typeDifferences.length)
})
test("documentation behind a transparent re-export is still compared",()=>{
  const result=compare({changedDoc:true})
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,false)
  assert.ok(result.docDifferences.length,JSON.stringify(result))
})
test("property: transparent exported types retain identity and reject field changes",()=>{
  assert.ok(readFileSync(new URL("../docs/design/vips/0027-declaration-output.md",import.meta.url),"utf8").includes(corpus.rule))
  fc.assert(fc.property(fc.constantFrom("File","InputValue","Declared"),fc.boolean(),fc.constantFrom("The input.","A retained descriptor."),(name,chain,doc)=>{
    const same=compare({name,chain,doc})
    assert.equal(same.comparisonComplete,true,JSON.stringify(same))
    assert.equal(same.identical,true,JSON.stringify(same))
    const changed=compare({name,chain,doc,changed:true})
    assert.equal(changed.comparisonComplete,true,JSON.stringify(changed))
    assert.equal(changed.identical,false)
    assert.ok(changed.typeDifferences.length)
  }),{numRuns:12,seed:270927})
})

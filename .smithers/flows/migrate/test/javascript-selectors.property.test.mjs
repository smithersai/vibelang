import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {createRequire} from "node:module"
import {test} from "node:test"
import {rewriteSourceLiterals} from "../lib/source-paths.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"

const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-javascript-source-selector.json",import.meta.url)))
test("JavaScript selector binding: VIP34Quoted",()=>{
 const spec=readFileSync(new URL("../../../../"+corpus.spec,import.meta.url),"utf8")
 assert.ok(spec.includes(corpus.quote),"Update the oracle when the accepted rule changes")
})
const rewrite=(text,file)=>rewriteSourceLiterals(ts,text,file,corpus.renames,{inventory:corpus.inventory})

for(const extension of ["js","mjs","jsx"]){
 test("JavaScript selector binding: "+extension+" tools retain the TypeScript selection proof",()=>{
  const expected=rewrite(corpus.source,"scan.ts")
  const actual=rewrite(corpus.source,"scan."+extension)
  assert.equal(actual.text,expected.text)
  assert.equal(actual.edits.length,1)
  assert.equal(actual.warnings.length,0)
  assert.equal(rewrite(actual.text,"scan."+extension).text,actual.text)
 })
}
test("JavaScript selector binding: CommonJS callbacks do not crash an unproved selector",()=>{
 const source=corpus.source.replace('import { readdirSync } from "node:fs";','const { readdirSync } = require("node:fs");')
 const actual=rewrite(source,"scan.cjs")
 assert.equal(actual.text,source)
 assert.equal(actual.edits.length,0)
})
test("JavaScript selector binding: escaping selectors remain unchanged across file kinds",async()=>{
 await checkProperty(fc,{
  name:"opencode-javascript-selector-binding",
  rule:corpus.quote+" "+corpus.rule,
  command:"node --test .smithers/flows/migrate/test/javascript-selectors.property.test.mjs",
  arbitrary:fc.record({
   extension:fc.constantFrom("js","mjs","jsx","ts","mts","cts"),
   escaped:fc.boolean(),
   name:fc.stringMatching(/^[a-z]{1,8}$/),
   callback:fc.constantFrom("() => ({ value: 1 })","function () { return { value: 1 } }","() => ({ get value() { return 1 } })")
  }),
  numRuns:80,
  check:({extension,escaped,name,callback})=>{
   const source=corpus.source.replaceAll("extension","selector_"+name).replace("() => ({ value: 1 })",callback)+(escaped?"\nconsole.log(selector_"+name+");\n":"")
   const actual=rewrite(source,"scan."+extension),control=rewrite(source,"scan.ts")
   assert.equal(actual.text,control.text)
   assert.equal(actual.edits.length,escaped?0:1)
   if(escaped)assert.equal(actual.text,source)
   else {
    const regex=actual.text.match(/const selector_\w+ = (\/.+\/);/)[1]
    const filter=Function("return "+regex)()
    assert.equal(filter.test("a.vibe"),true)
    assert.equal(filter.test("a.d.vibe.ts"),false)
   }
  }
 })
})

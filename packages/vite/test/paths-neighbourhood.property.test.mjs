import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { inspect } from "./paths-neighbourhood.mjs"

const require=createRequire(new URL("../../runtime/package.json",import.meta.url))
const fc=require("fast-check")
const fixture=JSON.parse(readFileSync(new URL("./property-regressions/t3code-vite-paths-importer.json",import.meta.url),"utf8"))
const raw=process.env.VIBELANG_VITE_PATHS_RAW==="1"
test("the Vite alias oracle retains the compiler-options contract",()=>{
  assert.ok(readFileSync(new URL("../../../docs/user/src/setup/vite.md",import.meta.url),"utf8").includes("The plugin compiles the project `tsconfig.json` describes, with its options and diagnostics."))
})
async function check(input,literal){
  const result=await inspect(input,literal)
  if(!raw && fixture.pending.keys.includes(result.key)){
    assert.equal(result.resolved,null,"XPASS "+result.key+": retire the pending alias-importer gap")
  } else {
    assert.equal(result.resolved,result.expected,"Vite resolves the configured path from a .vibe importer as from its identical .ts control")
  }
}
test("t3code: Vite tsconfig-path aliases keep their meaning after the importer becomes VibeLang",()=>check(fixture.input,fixture.files))
test("Vite alias-importer parity spans prefixes, nested projects and raw resource queries",async()=>{
  await fc.assert(fc.asyncProperty(fc.record({
    prefix:fc.constantFrom("~","@app"),depth:fc.integer({min:0,max:2}),query:fc.constantFrom("","?raw"),
  }),check),{seed:221045,numRuns:24,endOnFailure:true})
})

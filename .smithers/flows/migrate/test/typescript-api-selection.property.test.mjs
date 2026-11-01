import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { canonicalize, loadTypeScript } from "../lib/declarations.mjs"

const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const fc=require("fast-check")
const api=join(repo,"packages/runtime/node_modules/typescript")
const corpus=JSON.parse(readFileSync(new URL("./corpus/t3code-typescript-api-selection.json",import.meta.url),"utf8"))
const native=join(repo,"packages/ts-mapper/test/.cache/typescript-"+corpus.nativeVersion+"/node_modules/typescript")

function inspect(kinds) {
  const root=mkdtempSync(join(tmpdir(),"migrate-ts-api-"))
  try {
    const directories=kinds.map((kind,i)=>{
      const dir=join(root,"candidate-"+i)
      mkdirSync(join(dir,"node_modules"),{recursive:true})
      const target=join(dir,"node_modules/typescript")
      if(kind==="missing") {
        mkdirSync(target)
        writeFileSync(join(target,"package.json"),'{"name":"typescript","main":"missing.cjs"}\n')
      } else symlinkSync(kind==="api"?api:native,target)
      return dir
    })
    if(kinds.includes("api")) {
      const ts=loadTypeScript(directories)
      assert.equal(ts.version,require(api).version)
      assert.match(canonicalize(ts,corpus.source),/export declare const answer: 42;/)
      // A CLI-only package must never become a fabricated empty declaration.
      assert.notEqual(canonicalize(ts,corpus.source),canonicalize(ts,corpus.changedSource))
    } else {
      assert.throws(()=>loadTypeScript(directories),error=>{
        assert.match(error.message,/no TypeScript compiler API/)
        for(const directory of directories)assert.ok(error.message.includes(directory),"diagnostic names every candidate that was tried")
        if(kinds.includes("native"))assert.match(error.message,/has no compiler API/)
        return true
      })
    }
  } finally { rmSync(root,{recursive:true,force:true}) }
}

test("t3code: a native TypeScript installation needs a separate compiler API for migration preparation",()=>{
  assert.equal(JSON.parse(readFileSync(join(native,"package.json"),"utf8")).version,corpus.nativeVersion)
  for(const order of corpus.orders)inspect(order)
})
test("TypeScript API discovery covers CLI-only packages, missing modules and fallback positions",()=>{
  fc.assert(fc.property(fc.array(fc.constantFrom("native","api","missing"),{minLength:1,maxLength:6}),inspect),{seed:551044,numRuns:120,endOnFailure:true})
})

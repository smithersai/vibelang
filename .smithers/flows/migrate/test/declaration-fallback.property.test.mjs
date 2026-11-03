import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-ordinary-ts-import-provenance.json", import.meta.url)))

function compare(before, after, metadata) {
  const root = mkdtempSync(join(tmpdir(), "migrate-fallback-"))
  try {
    for (const [side, text] of [["before", before], ["after", after]]) {
      const dir = join(root, side)
      mkdirSync(dir)
      writeFileSync(join(dir, "main.d.ts"), text)
      writeFileSync(join(dir, "config.d.ts"), "export declare const a:1,b:2; export interface Config {}\n")
      mkdirSync(join(dir,"node_modules/@t3tools/contracts"),{recursive:true})
      writeFileSync(join(dir,"node_modules/@t3tools/contracts/package.json"),JSON.stringify({types:"index.d.ts"}))
      writeFileSync(join(dir,"node_modules/@t3tools/contracts/index.d.ts"),"export declare const ThreadId: string; export interface ScopedThreadRef {}")
      if (metadata === "resolved" || metadata === "unresolved" || metadata === side) {
        writeFileSync(join(dir, "public-surface.json"), JSON.stringify({
          roots: ["main.d.ts"], reachable: ["main.d.ts"],
          unresolved: metadata === "unresolved" ? ["./missing.ts"] : []
        }))
      }
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("t3code: equivalent import spellings and order pass; missing legacy metadata is unavailable", () => {
  for (const metadata of ["none", "before", "after", "unresolved", "resolved"]) {
    for (const [i,{before,after}] of corpus.modules.entries()) {
      const result=compare(before,after,metadata)
      assert.equal(result.comparison,"API identity")
      if(metadata!=="none"){
        assert.equal(result.comparisonComplete,false,JSON.stringify(result))
        assert.deepEqual(result.changed,[])
        assert.ok(result.environmentDiagnostics.length)
      } else {
        assert.equal(result.comparisonComplete,true,JSON.stringify(result))
        assert.equal(result.identical,i!==3,JSON.stringify(result))
        if(i===3) assert.ok(result.docDifferences.length)
        assert.equal(compare(before,before,metadata).identical,true)
      }
    }
  }
})
test("property: legacy metadata never proves identity; complete modules compare their API",()=>{
  fc.assert(fc.property(
    fc.constantFrom("none","before","after","unresolved","resolved"),
    fc.integer({min:0,max:corpus.modules.length-1}),fc.boolean(),
    (metadata,pattern,changed)=>{
      const witness=corpus.modules[pattern]
      const result=compare(witness.before,changed?witness.after:witness.before,metadata)
      assert.equal(result.comparisonComplete,metadata==="none",JSON.stringify(result))
      assert.equal(result.identical,metadata==="none"&&(!changed||pattern!==3),JSON.stringify(result))
    }
  ),{seed:263277,numRuns:160})
})

import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"
test("sidecar preference follows the final path and preserves explicit inputs",()=>{
 const text=chapter("007-tooling")
 for(const s of ["final resolved path","realpath","preserveSymlinks: true","package `#imports`","paths","x.d.vibex.ts","Ordinary `.ts` and `.d.ts` resolution does not change","map names"]) assert.ok(text.includes(s),s)
 assert.match(read("docs/design/vips/0027-declaration-output.md"),/sidecars reached by non-relative names/)
})

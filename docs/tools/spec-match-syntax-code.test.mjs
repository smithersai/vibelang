import assert from "node:assert/strict"
import test from "node:test"
import {block,chapter,read,run} from "./spec-witness.mjs"
test("pattern-syntax fallback follows source ownership without hiding native errors",()=>{
 const source=chapter("004-match")
 for(const text of ["use `EK0707` when no more specific","same rejection","retain TypeScript's diagnostics",
   "malformed native templates","TS2304"])
  assert.ok(source.includes(text),text)
 assert.ok(chapter("900-appendices").includes("| `EK0707` |"))
 assert.ok(read("docs/user/src/vibelang-features/116-match-and-is.md").includes("an interpolated primitive pattern is `EK0707`"))
 assert.ok(read("docs/design/vips/0007-match.md").includes("remaining pattern-syntax diagnostics"))
 const result=run(block(source,"const patternSyntaxExit")+`
if(!Exit.isSuccess(patternSyntaxExit)||JSON.stringify(patternSyntaxExit.value)!==JSON.stringify([1,0,0])) throw new Error("changed guard repair")
`)
 assert.equal(result.status,0,result.stdout+result.stderr)
})

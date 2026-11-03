import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"
test("the fourth migration warning is identity-selected and preserves local types",()=>{
 const text=chapter("007-tooling")
 for(const s of ["EK4856","resolved legacy symbol","local and imported types","coordinated compiler"]) assert.ok(text.includes(s),s)
 const row=chapter("900-appendices").split("\n").find(l=>l.startsWith("| `EK4856`"))
 assert.match(row,/warning:.*retired global/)
 assert.match(row,/A!E!R/)
 assert.match(read("docs/design/vips/0003-effect-type-shorthand.md"),/EK4856/)
})

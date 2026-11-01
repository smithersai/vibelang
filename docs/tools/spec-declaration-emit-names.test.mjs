import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"
test("emit names distinguish runtime JavaScript from selected declaration spelling",()=>{
 const line=chapter("007-tooling").split("\n").find(l=>l.includes("**Emit names.**"))
 for(const s of ["declarationImportStyle","extensionless","every other written specifier","JavaScript output"]) assert.ok(line.includes(s),s)
 assert.match(read("docs/design/vips/0034-compiler-and-tooling.md"),/declaration import spelling/)
})

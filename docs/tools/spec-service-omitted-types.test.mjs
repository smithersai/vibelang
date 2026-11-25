import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"
test("service signatures state the native implicit-any rule",()=>{
 const text=chapter("005-services")
 for(const s of ["an omitted type follows TypeScript's `noImplicitAny`","TS7010","TS7008","VibeLang adds no diagnostic of its own"]) assert.ok(text.includes(s),s)
 assert.match(read("docs/design/vips/0009-service-declarations.md"),/omitted member types/)
})

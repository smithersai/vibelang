import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"
test("fix scope includes owned imported files and excludes external inputs",()=>{
 const text=chapter("007-tooling")
 for(const s of ["the selected project's own files","an owned source an import reaches","an extended config under `node_modules` is reported, not edited","with `-b`, each project fixes its own files","never overwrites an existing file","not-fixed explanation"]) assert.ok(text.includes(s),s)
 for(const name of [".vibex",".d.vibe.ts",".d.vibex.ts","typeRoots","tsBuildInfoFile","declarationSidecars"]) assert.ok(text.includes("`"+name+"`"),name)
 assert.match(read("docs/design/vips/0034-compiler-and-tooling.md"),/which files `--fix` writes/)
 const platform=chapter("005-services")
 assert.ok(platform.includes("that does not exist yet"))
 assert.ok(platform.includes("run phase, captures, receiver and public types"))
})

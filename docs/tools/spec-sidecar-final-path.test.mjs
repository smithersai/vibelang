import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

const clauses = [
 ["chapter", "available mapped source only when TypeScript's final resolved path is outside `node_modules`"],
 ["chapter", "package exports, `paths` and package `#imports`"],
 ["chapter", "Apply `realpath` and `preserveSymlinks` first"],
 ["chapter", "a retained logical dependency path keeps its declaration and native module identity"],
 ["chapter", "The rule also applies to the effective `sidecarDir` map"],
 ["chapter", "Explicitly selected declarations remain inputs subject to the ordinary overwrite guard"],
 ["vip", "known `.d.vibe.ts`/`.d.vibex.ts` sidecar uses its available source only when the final path is outside `node_modules`"],
 ["vip", "follow the recorded source map, never a guessed basename"],
 ["vip", "Ordinary TypeScript source/declaration resolution is unchanged"],
]
function checkResolutionContract(sources) {
 for (const [owner,clause] of clauses) assert.ok(sources[owner].includes(clause), owner+": "+clause)
}
function sources() {
 return {chapter:chapter("007-tooling"),vip:read("docs/design/vips/0027-declaration-output.md")}
}
test("sidecar preference follows the final path and preserves explicit inputs",()=>{
 checkResolutionContract(sources())
})

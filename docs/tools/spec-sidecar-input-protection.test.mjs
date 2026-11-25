import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"
const writeClauses = [
 "a sidecar found through `include` yields to its source and emit may overwrite it",
 "Listing both the source and its sidecar explicitly in `files` keeps the sidecar as an input",
 "emit reports `TS5055`, exits `1`, and leaves its bytes untouched",
 "The same rule applies in the `vibe.sidecarDir` directory",
 "The required sidecar write is independent of `noEmit` and `declaration: false`",
]
function checkWriteContract(text) {
 for (const clause of writeClauses) assert.ok(text.includes(clause), clause)
}
test("sidecar discovery and explicit input have distinct write contracts",()=>{
 checkWriteContract(chapter("007-tooling"))
 assert.match(read("docs/design/vips/0027-declaration-output.md"),/sidecar is an emit output/)
})

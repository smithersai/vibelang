// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"

for(const source of ["export const p = async effect { return 7 }","export const p = effect async { return 7 }"]) {
 const p=project(import.meta.url,"dual-"+(source.includes("async effect")?"a":"b"),{"input.vibe":source})
 const before=check(p)
 assert.match(before.output,/EK0105/)
 const fixed=check(p,["--fix"])
 const text=p.read("input.vibe")
 assert.match(text,/effect\s*\{\s*return 7/)
 assert.doesNotMatch(text,/\basync\b/)
 const after=check(p)
 assert.equal(after.status,0,after.output)
}

// Spec rule: docs/design/src/001-functions.md#aa9ff362d91deef4
// Chapter 001: block-fix.
console.log("coverage-ok")

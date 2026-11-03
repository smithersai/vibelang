// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"

const source="export type Meta=typeof import.meta\n"
const p=project(import.meta.url,"vibe",{"input.vibe":source})
const native=project(import.meta.url,"native",{"input.ts":source})
const actual=check(p), reference=nativeCheck(native)
assert.deepEqual(codes(actual.output),codes(reference.output),"the type position must have stock TypeScript's diagnostics")
assert.equal(actual.status===0,reference.status===0)
assert.ok(!codes(actual.output).includes("EK4402"))

// Spec rule: docs/design/src/005-services.md#52c090defdce0dcb
// Chapter 005: type-position.
console.log("coverage-ok")

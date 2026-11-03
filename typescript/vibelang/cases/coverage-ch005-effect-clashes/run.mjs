// run-seconds: 420
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.deepEqual(actual.values,native.values)
assert.deepEqual(actual.builtinUndefined,native.builtinUndefined)

// Each negative is compiled alone, so one unknown name cannot mask another.
const { project, check, codes, nativeCheck } = await import("../../tests/coverage-tooling.mjs")
for (const name of ["match","when","service","provide","uninterruptible","interruptible"]) {
 const p=project(import.meta.url,"clash-"+name,{"input.vibe":"export const value="+name+"\n"})
 const result=check(p)
 assert.notEqual(result.status,0,"Effect."+name+" must keep its qualifier")
 const reference=project(import.meta.url,"native-clash-"+name,{"input.ts":"export const value="+name+"\n"})
 const expected=nativeCheck(reference)
 assert.notEqual(expected.status,0,expected.output)
 assert.deepEqual(codes(result.output),codes(expected.output),result.output)
 assert.ok(result.output.includes("Cannot find name '"+name+"'"),result.output)
}
console.log("coverage-ok")

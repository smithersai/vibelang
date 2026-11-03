// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"

const good=project(import.meta.url,"good",{"input.vibe":'service Good { static readonly key="coverage/Good"; value:number }'})
assert.equal(check(good).status,0)
const bad=project(import.meta.url,"bad",{"input.vibe":'service class Legacy { static readonly key="coverage/Legacy"; value:number }'})
const result=check(bad)
assert.notEqual(result.status,0,"Only service Name declares a service; the retired service class spelling compiled")

// Spec rule: docs/design/src/005-services.md#f8703eef39867821
// Chapter 005: only.
console.log("coverage-ok")

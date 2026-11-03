// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"

const p=project(import.meta.url,"capture",{"input.vibe":'export function key<T>() { service S { static readonly key="coverage/CaptureAdvice"; value:T }; return S }'})
const result=check(p)
assert.match(result.output,/error EK3005:/)
assert.match(result.output,/concrete|polymorphic|member.local|outside[^\n]*(?:generic|scope|capture|function)/i,"the diagnostic needs concrete-shape or member-local-generic advice")

// Spec rule: docs/design/src/005-services.md#dec28d015889300a
// Chapter 005: advice.
console.log("coverage-ok")

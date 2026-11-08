// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { cpSync, readFileSync } from "node:fs"
import { result } from "./out/main.js"

assert.equal(result, 3)
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const checked = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(checked.error, undefined)
assert.notEqual(checked.status, 0, "class-only service syntax must be rejected")
const output = checked.stdout + checked.stderr
const diagnostics = [...output.matchAll(/^.*\((\d+),\d+\): error ([A-Z]+)(\d+):/gm)]
// Diagnostic identity is numeric; padding is checked by the diagnostic writer's tests.
assert.equal(diagnostics.length, 12, output)
assert.deepEqual(diagnostics.map(m => Number(m[1])).sort((a,b) => a-b), Array.from({length:12}, (_,i) => i+1), output)
assert(diagnostics.every(m => m[2] === "EK" && Number(m[3]) === 902), output)
console.log("service modifiers validated")

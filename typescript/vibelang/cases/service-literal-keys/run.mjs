import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { result } from "./out/main.js"
assert.equal(result, "literal/Good")
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const checked = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(checked.error, undefined)
assert.notEqual(checked.status, 0)
const output = checked.stdout + checked.stderr
const diagnostics = [...output.matchAll(new RegExp("^.*[(]([0-9]+),[0-9]+[)]: error ([A-Z]+)([0-9]+):", "gm"))]
assert.equal(diagnostics.length, 5, output)
assert.deepEqual(diagnostics.map(m => Number(m[1])).sort((a,b) => a-b), [2,3,4,5,6], output)
assert(diagnostics.every(m => m[2] === "EK" && Number(m[3]) === 901), output)
console.log("literal service keys validated")

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { result } from "./out/main.js"
assert.deepEqual(result, [true, "example.com", 4, true, true])
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const checked = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(checked.error, undefined)
const output = checked.stdout + checked.stderr
assert.notEqual(checked.status, 0, output)
const rows = [...output.matchAll(new RegExp("^.*[(]([0-9]+),[0-9]+[)]: error ([A-Z]+)([0-9]+):", "gm"))]
assert.equal(rows.length, 17, output)
assert.deepEqual(rows.map(m => Number(m[1])).sort((a,b) => a-b), [1,2,3,5,6,7,8,9,11,12,13,14,15,16,17,18,19], output)
assert(rows.every(m => m[2] === "EK" && Number(m[3]) === 4402), output)
const local = spawnSync(compiler, ["-p", fileURLToPath(new URL("project-lib/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(local.error, undefined)
assert.equal(local.status, 0, local.stdout + local.stderr)
console.log("host-reaching members rejected")

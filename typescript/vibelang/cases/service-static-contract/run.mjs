import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { result } from "./out/main.js"
assert.deepEqual(result, ["literal/Keyed", "service-static-contract/main#Defaults", 7, 3])
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const checked = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(checked.error, undefined)
assert.notEqual(checked.status, 0, checked.stdout + checked.stderr)
const output = checked.stdout + checked.stderr
const diagnostics = [...output.matchAll(new RegExp("^.*[(]([0-9]+),[0-9]+[)]: error ([A-Z]+)([0-9]+):", "gm"))]
assert.equal(diagnostics.length, 9, output)
assert.deepEqual(diagnostics.map(m => Number(m[1])).sort((a,b) => a-b), [1,2,3,4,5,6,7,8,9], output)
assert(diagnostics.every(m => m[2] === "EK" && Number(m[3]) === 902), output)
console.log("service static contracts validated")

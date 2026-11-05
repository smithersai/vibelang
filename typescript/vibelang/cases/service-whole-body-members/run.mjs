import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const project = fileURLToPath(new URL("input/tsconfig.json", import.meta.url))
const result = spawnSync(compiler, ["-p", project, "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(result.error, undefined)
const output = result.stdout + result.stderr
const errors = [...output.matchAll(/error ([A-Z]+[0-9]+):/g)].map(m=>m[1])
assert.notEqual(result.status, 0, output)
assert.deepEqual(errors, ["EK0902","EK0902","EK0902"], output)
console.log("whole-shape members validated")

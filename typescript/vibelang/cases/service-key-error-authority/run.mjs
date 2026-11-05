import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const result = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(result.error, undefined)
const output = result.stdout + result.stderr
const errors = [...output.matchAll(/error ([A-Z]+[0-9]+):/g)].map(m=>m[1])
assert.notEqual(result.status, 0, output)
assert.deepEqual(errors.sort(), ["EK0901","EK0901","EK0901","TS2417"], output)
assert.match(output, /main[.]vibe[(]5,[0-9]+[)]: error TS2417:/)
console.log("service key diagnostics validated")

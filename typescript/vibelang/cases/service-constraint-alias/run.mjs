// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const result = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], { encoding: "utf8", timeout: 120000 })
assert.equal(result.error, undefined)
assert.equal(result.signal, null)
assert.notEqual(result.status, 0)
const output = result.stdout + result.stderr
const rows = [...output.matchAll(/main[.]vibe[(]([0-9]+),[0-9]+[)]: error ([A-Z]+[0-9]+):/g)]
const expected = [3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3004, 3003, 3002, 3003, 3002]

assert.equal(rows.length, expected.length, output)
for (let line = 1; line <= expected.length; line++) {
  assert.deepEqual(rows.filter(row => Number(row[1]) === line).map(row => row[2]), ["EK"+expected[line-1]], output)
}
console.log("generic constraint service identity diagnostics validated")

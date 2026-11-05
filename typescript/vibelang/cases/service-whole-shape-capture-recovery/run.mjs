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
assert.equal(rows.length, 7, output)
for (const line of [1,2,3,5]) {
 assert.deepEqual(rows.filter(row => Number(row[1]) === line).map(row => row[2]), ["EK0902"], output)
}
assert.deepEqual(rows.filter(row => row[1] === "4").map(row => row[2]).sort(), ["EK0902","EK3005"], output)
assert.deepEqual(rows.filter(row => row[1] === "6").map(row => row[2]), [], output)
assert.deepEqual(rows.filter(row => row[1] === "7").map(row => row[2]), ["TS2322"], output)
console.log("whole-shape service capture diagnostics validated")

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
const native = ["TS2304", "TS2304", "TS2322", "TS2339", "TS2345", "TS2304", "TS2304", "TS2322"]
assert.equal(rows.length, 16, output)
native.forEach((code, index) => {
  assert.deepEqual(rows.filter(row => Number(row[1]) === index + 1).map(row => row[2]).sort(), ["EK0901", code], output)
})
console.log("independent service key errors preserved")

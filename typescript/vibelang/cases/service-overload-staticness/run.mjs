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
const expected = [
  ["EK0902", "EK0902"],
  ["EK0902", "EK0902"],
  ["EK0902"],
  ["EK0902", "EK0902"],
  ["EK0902", "TS2387"],
  ["EK0902", "TS2388"],
  ["TS2387"],
  ["TS2388"],
]
assert.equal(rows.length, expected.reduce((n, codes) => n + codes.length, 0), output)
expected.forEach((codes, index) => {
  assert.deepEqual(rows.filter(row => Number(row[1]) === index + 1).map(row => row[2]).sort(), codes, output)
})
console.log("service overload diagnostics retain native boundaries")

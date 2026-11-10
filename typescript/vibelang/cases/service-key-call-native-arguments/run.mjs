// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const r = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], { encoding: "utf8", timeout: 120000 })
assert.equal(r.error, undefined)
assert.equal(r.signal, null)
assert.notEqual(r.status, 0)
const output = r.stdout + r.stderr
const rows = [...output.matchAll(/main[.]vibe[(]([0-9]+),[0-9]+[)]: error ([A-Z]+[0-9]+):/g)]
const native = [2349, 2554, 2554, 2554, 2554, 2554, 2349, 2304, 2345, 2339, 0, 0]
assert.equal(rows.length, native.length + native.filter(Boolean).length, output)
native.forEach((code, i) => {
  const expected = code ? ["EK9214", "TS" + code] : ["EK9214"]
  assert.deepEqual(rows.filter(row => Number(row[1]) === i + 1).map(row => row[2]).sort(), expected.sort(), output)
})
console.log("service call argument errors preserved")

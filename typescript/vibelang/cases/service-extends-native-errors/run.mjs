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
const diagnostics = [...output.matchAll(/main[.]vibe[(]([0-9]+),[0-9]+[)]: error ([A-Z]+[0-9]+):/g)]
for (let index = 0; index < 16; index++) {
 const row = diagnostics.filter(d => Number(d[1]) === index + 1).map(d => d[2])
 const native = index % 8 === 6 ? "TS2339" : index % 8 === 7 ? "TS2345" : "TS2304"
 assert.equal(row.filter(code => code === "EK3002").length, 1, output)
 assert.equal(row.filter(code => code === native).length, 1, output)
}
assert.equal(diagnostics.filter(d => d[2] === "TS2307").length, 0, output)
console.log("independent service heritage errors preserved")

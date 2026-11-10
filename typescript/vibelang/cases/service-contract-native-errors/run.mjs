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
const expected = [["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2411"], ["EK0902", "TS2411"], ["EK0902", "TS1024"], ["EK0902", "TS7006"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS1024"], ["EK0902", "TS7006"], ["EK0902"], ["EK0902"], ["EK0902"], ["EK0902"], ["EK0902"], ["EK0902"], ["EK0902"], ["EK0902"], ["EK0902"], ["EK0902"], ["EK0902"], ["TS2304"], ["TS2304"], ["EK0106", "EK0902", "TS2304"], ["EK0902", "TS18019", "TS2304"], ["EK0902", "TS2304"], ["EK0902", "TS2304"], ["EK0902"], ["EK0902"], ["EK0902", "TS1064"]]
assert.equal(rows.length, 73, output)
expected.forEach((codes,index)=>{assert.deepEqual(rows.filter(row=>Number(row[1])===index+1).map(row=>row[2]).sort(),codes,output)})
console.log("independent service contract errors preserved")

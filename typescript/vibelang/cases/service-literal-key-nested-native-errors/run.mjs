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
const actual = [...output.matchAll(/main[.]vibe[(]([0-9]+),[0-9]+[)]: error ([A-Z]+[0-9]+):/g)]
const expected = [["EK0901", "TS7008"], ["EK0901", "TS7008"], ["EK0901", "TS1255"], ["EK0901", "TS7008", "TS1255"], ["EK0901", "TS7008"], ["EK0901", "TS1255"], ["EK0901", "TS7008"], ["EK0901", "TS7008"], ["EK0901", "TS2304"], ["EK0901"], ["EK0901"], [], ["EK0901", "TS7008"], ["EK0901", "TS7008"], ["EK0901", "TS1255"], ["EK0901", "TS7008", "TS1255"], ["EK0901", "TS7008"], ["EK0901", "TS1255"], ["EK0901", "TS7008"], ["EK0901", "TS7008"], ["EK0901", "TS2304"], ["EK0901"], ["EK0901"], [], ["TS7008"], ["TS1255"], ["EK0901", "TS7008"], ["EK0901", "TS1255"]]
assert.equal(actual.length, expected.flat().length, output)
expected.forEach((codes, index) => assert.deepEqual(actual.filter(row => Number(row[1]) === index + 1).map(row => row[2]).sort(), codes.sort(), output))
console.log("nested service-key errors preserved")

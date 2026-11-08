// run-seconds: 120
import assert from "node:assert/strict"
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as native from "./native.ts"
import * as original from "./out/main.js"

const expected = native.inspect()
assert.deepEqual(original.initialized, ["get:type"])
const originalTrace = original.inspect()
assert.deepEqual(originalTrace, expected)
assert.deepEqual(expected.after, ["get:type", "get:value", "get:value", "get:value"])
const evidence = new URL("out/fix-evidence/", import.meta.url)
mkdirSync(evidence, { recursive: true })
for (const name of ["main.vibe", "constants.ts", "tsconfig.json", "package.json"]) {
  cpSync(new URL(name, import.meta.url), new URL(name, evidence))
}
const tsc = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const config = fileURLToPath(new URL("tsconfig.json", evidence))
assert.equal(native.earlyResult, "tdz")
assert.equal(original.earlyResult, native.earlyResult)

console.log("native, original and repaired operand traces agree")

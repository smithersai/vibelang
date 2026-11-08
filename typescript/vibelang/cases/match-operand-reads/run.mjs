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
const log = execFileSync(tsc, ["-p", config, "--fix"], { encoding: "utf8" })
writeFileSync(new URL("fix.log", evidence), log)
const repairedText = readFileSync(new URL("main.vibe", evidence), "utf8")
execFileSync(tsc, ["-p", config], { encoding: "utf8" })
const repaired = await import(new URL("out/main.js", evidence))
assert.equal(readFileSync(new URL("out/main.d.ts", evidence), "utf8"), readFileSync(new URL("out/main.d.ts", import.meta.url), "utf8"))
const repairedTrace = repaired.inspect()
writeFileSync(new URL("trace-comparison.json", evidence), JSON.stringify({
  native: { initialized: native.initialized, trace: expected },
  original: { initialized: original.initialized, trace: originalTrace },
  repaired: { initialized: repaired.initialized, trace: repairedTrace },
}, null, 2) + "\n")
assert.deepEqual(
  { initialized: repaired.initialized, trace: repairedTrace },
  { initialized: native.initialized, trace: expected },
)
for (const operand of ["config.ready", "captured.ready", "stable.ready", "computedReady", "mutableReady", "literalReady", "eagerReady"]) {
  assert.ok(repairedText.includes("Match.when(" + operand), operand + " must keep its advisory without repair")
}
assert.ok(!repairedText.includes("Match.when(localReady"))
assert.equal(native.earlyResult, "tdz")
assert.equal(original.earlyResult, native.earlyResult)
assert.equal(repaired.earlyResult, native.earlyResult)

console.log("native, original and repaired operand traces agree")

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { cpSync, readFileSync } from "node:fs"
import { result } from "./out/main.js"

assert.equal(result, 3)
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const checked = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(checked.error, undefined)
assert.notEqual(checked.status, 0, "class-only service syntax must be rejected")
const output = checked.stdout + checked.stderr
const diagnostics = [...output.matchAll(/^.*\((\d+),\d+\): error ([A-Z]+)(\d+):/gm)]
// Diagnostic identity is numeric; padding is checked by the diagnostic writer's tests.
assert.equal(diagnostics.length, 12, output)
assert.deepEqual(diagnostics.map(m => Number(m[1])).sort((a,b) => a-b), Array.from({length:12}, (_,i) => i+1), output)
assert(diagnostics.every(m => m[2] === "EK" && Number(m[3]) === 902), output)
const fixedDir = new URL("out/fix-evidence/", import.meta.url)
cpSync(new URL("input/", import.meta.url), fixedDir, {recursive:true})
const fixArgs = ["-p", fileURLToPath(new URL("tsconfig.json", fixedDir)), "--fix", "--noEmit", "--pretty", "false"]
const first = spawnSync(compiler, fixArgs, {encoding:"utf8"})
assert.equal(first.error, undefined)
assert.notEqual(first.status, 0, "the private name still needs a deliberate public name")
const fixedSource = readFileSync(new URL("invalid.vibe", fixedDir), "utf8")
assert(fixedSource.includes("service Public { n: number }"), fixedSource)
assert(fixedSource.includes("service Definite { n: number }"), fixedSource)
assert(fixedSource.includes("service EffectMethod { run(): number!! }"), fixedSource)
const remaining = [...(first.stdout+first.stderr).matchAll(/^.*\((\d+),\d+\): error ([A-Z]+)(\d+):/gm)]
assert.equal(remaining.length, 1, first.stdout+first.stderr)
assert.equal(Number(remaining[0][1]), 10)
assert.equal(Number(remaining[0][3]), 902)
spawnSync(compiler, fixArgs, {encoding:"utf8"})
assert.equal(readFileSync(new URL("invalid.vibe", fixedDir), "utf8"), fixedSource, "a second fix is idempotent")
console.log("service modifiers validated")

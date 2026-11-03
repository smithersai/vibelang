// run-seconds: 150
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#aeace3fd9a4c23dd
// VIP-5: Repair explicitly to x catch effect (e) => { B
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#d2b98d8ca10164ed
// VIP-5: A mechanical repair must preserve valid parameters, bindings and source
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#20c505ddefde49b4
// VIP-5: Suggest an explicit existing function-literal repair, normally x catch effect
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#e5d1b5fff35d7fc9
// VIP-5: vibe effect function bad() { return try fail("x") catch (e)
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const here = dirname(fileURLToPath(import.meta.url))
const compiler = resolve(here,"../../../built/local/tsc")
function fixed(source, check) {
  const dir = mkdtempSync(join(tmpdir(),"vip-coverage-fix-"))
  try {
    writeFileSync(join(dir,"main.vibe"),source)
    writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",lib:["esnext","dom"],module:"esnext",moduleResolution:"bundler",strict:true,types:[],outDir:"out"},include:["*.vibe"]}))
    writeFileSync(join(dir,"package.json"),'{"type":"module"}')
    symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
    const result = spawnSync(compiler,["-p",dir,"--fix","--pretty","false"],{encoding:"utf8",timeout:120000})
    assert.ifError(result.error)
    check(readFileSync(join(dir,"main.vibe"),"utf8"),result)
  } finally { rmSync(dir,{recursive:true,force:true}) }
}

const source = 'effect function main() { return try Effect.fail("x") catch (e) { return 0 } }'
fixed(source,(after,result) => {
  assert.equal(result.status,0,result.stdout + result.stderr)
  assert.match(after,/catch\s+(?:effect\s+)?\(e\)\s*=>/)
  assert.doesNotMatch(after,/return\s+try\s+Effect\.fail/)
})
console.log("malformed handler fix preserves binding and removes invalid try head")

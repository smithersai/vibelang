// run-seconds: 390
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#1440738c5479ab51
// VIP-5: A failed Effect operand test is not repaired by inventing
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#0ec7939daa3455dd
// VIP-5: The migration must not silently insert an asEffect() call based
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#cca862dc1f9b8dde
// VIP-5: Replace the end of chapter007 VIP-migration wording with the actual
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#de9d17e86ead63d2
// VIP-5: Preserve the preceding requirement to retain structurally valid try operands.
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

for (const operand of ["Option.some(1)","Result.succeed(2)","({ asEffect() { return Effect.succeed(3) } })"]) {
  const source = "effect function main() { return try " + operand + " }"
  fixed(source,(after,result) => {
    assert.notEqual(result.status,0,"the invalid operand must remain rejected")
    assert.match(result.stdout+result.stderr,/EK0502/)
    assert.doesNotMatch(after,/\.asEffect\s*\(/)
    assert.match(after,/return\s+try\b/,"no automatic unwrap or operand conversion")
  })
}
console.log("operand fix keeps invalid Effect operands rejected without guessed conversion")

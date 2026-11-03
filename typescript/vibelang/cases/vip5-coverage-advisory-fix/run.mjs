// run-seconds: 150
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#2c9e3ad0141d1af3
// VIP-5: For an eligible direct try, a quick fix is still
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#3ca0137d41660b2c
// VIP-5: Do not turn fork Effect.fail(e) into a caller-side throw, replace
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

const source = `export effect function main() {
  const one = try Effect.succeed(1)
  const child = fork Effect.catch(Effect.fail("x"), () => Effect.succeed(7))
  const failed = fork Effect.fail("boom")
  const provided = fork Effect.provide(Effect.succeed(8), Layer.empty)
  const both = try.all [Effect.succeed(one), Effect.succeed(2)]
  const stored = Effect.succeed(9)
  void failed
  return [one, join child, join provided, both, stored]
}`
fixed(source,(after,result) => {
  assert.equal(result.status,0,result.stdout + result.stderr)
  assert.doesNotMatch(after,/const one = try Effect\.succeed/)
  for (const preserved of [
    'fork Effect.catch(Effect.fail("x"), () => Effect.succeed(7))',
    'fork Effect.fail("boom")',
    'fork Effect.provide(Effect.succeed(8), Layer.empty)',
    'try.all [Effect.succeed(one), Effect.succeed(2)]',
    'const stored = Effect.succeed(9)'
  ]) assert.ok(after.includes(preserved), "preserve " + preserved)
})
console.log("advisory fix distinguishes direct try and negative execution consumers")

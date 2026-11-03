// run-seconds: 150
// rule-evidence: docs/design/vips/0004-throw.md#9ce36360397b53a9
// VIP-4: @throws on an effectful callable
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


const source = `/** Keep this description.
 * @throws {Error}
 */
effect function main() { return 1 }
/** @rethrows callback */
const arrow = effect (callback: () => number) => callback()
`
fixed(source,(after,result)=>{
 assert.equal(result.status,0,result.stdout+result.stderr)
 assert.doesNotMatch(after,/@throws|@rethrows/)
 assert.ok(after.includes("Keep this description"))
})
console.log("effectful annotation repair removes tags and preserves prose")

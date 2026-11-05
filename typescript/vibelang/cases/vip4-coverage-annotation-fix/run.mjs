// run-seconds: 240
// rule-evidence: docs/design/vips/0004-throw.md#9ce36360397b53a9
// VIP-4 rejects source throw contracts; VIP-34 preserves authored documentation.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
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
    const after=readFileSync(join(dir,"main.vibe"),"utf8")
    check(after,result)
    assert.equal(after,source,"automatic fixes preserve every authored documentation byte")
    const edited=source.replace(/^.*@throws.*\n/gm,"").replace(/\/\*\* @rethrows callback \*\/\n/g,"")
    writeFileSync(join(dir,"main.vibe"),edited)
    const checked=spawnSync(compiler,["-p",dir,"--pretty","false"],{encoding:"utf8",timeout:120000})
    assert.ifError(checked.error)
    assert.equal(checked.status,0,checked.stdout+checked.stderr)
    assert.ok(edited.includes("Keep this description"),"manual migration keeps description")
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
 assert.equal(result.status,2,result.stdout+result.stderr)
 assert.equal((result.stdout.match(/error EK0406:/g)||[]).length,2,result.stdout)
 assert.match(result.stdout+result.stderr,/No automatic fix|no fix applies/)
 assert.match(after,/@throws/)
 assert.match(after,/@rethrows/)
 assert.ok(after.includes("Keep this description"))
})
const require=createRequire(resolve(here,"../../../../packages/runtime/package.json"))
const fc=require("fast-check")
fc.assert(fc.property(fc.constantFrom("Error","never","RangeError"),fc.integer({min:0,max:9}), (kind,n)=>{
 const variant=source.replace("@throws {Error}","@throws {"+kind+"}").replace("Keep this description.","Keep this description. "+"prose ".repeat(n))
 fixed(variant,(after,result)=>{assert.equal(after,variant);assert.equal(result.status,2,result.stdout+result.stderr)})
}),{seed:406003,numRuns:12})
console.log("throw-tag migration preserves documentation and reports manual edits")

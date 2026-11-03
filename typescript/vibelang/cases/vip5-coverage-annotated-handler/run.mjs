// run-seconds: 750
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#9b4c2edbfade8b76
// VIP-5: annotated handler parameters
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#8fbbb2a7917e373e
// VIP-5: catch (e: NotFound) => …: a type annotation on a
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
    const result = spawnSync(compiler,["-p",dir,"--pretty","false"],{encoding:"utf8",timeout:120000})
    assert.ifError(result.error)
    check(readFileSync(join(dir,"main.vibe"),"utf8"),result)
  } finally { rmSync(dir,{recursive:true,force:true}) }
}


const cases=[
 ['Effect.fail("x") catch (e: string) => e.length',true],
 ['Effect.fail("x") catch effect (e: string) => e.length',true],
 ['Effect.fail("x") catch function (e: string) { return e.length }',true],
 ['Effect.fail("x") catch effect function (e: string) { return e.length }',true],
 ['Effect.fail("x") catch (e: number) => e + 1',false],
 ['Effect.fail({code:1}) catch ({code}: {code:number}) => code',true]
]
const problems=[]
for (const [expression,valid] of cases) fixed("effect function main() { return "+expression+" }",(_after,result)=>{
 const output=result.stdout+result.stderr
 if ((result.status===0)!==valid) problems.push(expression+" exit="+result.status)
 if (/: (?:error|warning) EK2112:/.test(output)) problems.push(expression+" retired EK2112")
 if (!valid&&!/error TS[0-9]+:/.test(output)) problems.push(expression+" missing TypeScript assignability rejection")
})
assert.deepEqual(problems,[])
console.log("typed handler parameters use TypeScript checking without retired EK2112")

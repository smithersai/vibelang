import {checkSyntaxTwin} from "../../test/census-vibex.mjs"
checkSyntaxTwin(import.meta.url)
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,writeFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join,dirname,resolve} from "node:path"
const dir=dirname(fileURLToPath(import.meta.url))
const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const stock=resolve(process.env.EFFECT_NODE_MODULES,"typescript/bin/tsc")
const source="const effect=1; effect\n(x)=>x"
const sets=[]
for(const ext of ["vibex","tsx"]) {
 const cwd=join(dir,"out",ext);mkdirSync(cwd,{recursive:true})
 writeFileSync(join(cwd,"main."+ext),source)
 writeFileSync(join(cwd,"tsconfig.json"),JSON.stringify({compilerOptions:{jsx:"preserve",module:"esnext",noCheck:true,noEmit:true,types:[]},files:["main."+ext]}))
 const run=spawnSync(ext==="tsx"?process.execPath:compiler,ext==="tsx"?[stock,"-p",cwd,"--pretty","false"]:["-p",cwd,"--pretty","false"],{encoding:"utf8",timeout:60000})
 assert.notEqual(run.status,null)
 sets.push([...run.stdout.matchAll(/error (TS|EK)([0-9]+)/g)].map(m=>m[1]+m[2]).sort())
}
assert.deepEqual(sets[0],sets[1],"a line break prevents the effect modifier")

console.log("VIP-39 PASS")

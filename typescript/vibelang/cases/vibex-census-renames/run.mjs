// VIP-39 Renaming parses the same both ways. Renaming x.vibe to: docs/design/vips/0039-vibex.md#23363d729fa1c720
// VIP-39 JSX in every .vibe file Flow Babel ReScript CoffeeScript: docs/design/vips/0039-vibex.md#647b0a4b1a01af73
import assert from "node:assert/strict"
import {mkdirSync,writeFileSync} from "node:fs"
import {spawnSync} from "node:child_process"
import {fileURLToPath} from "node:url"
import {join,dirname} from "node:path"
const dir=dirname(fileURLToPath(import.meta.url))
const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
for(const [key,source] of [
 ["assertion","const value = <number>x"],
 ["effect-generic","const id = effect <T>(x:T)=>x"],
 ["regexp","const value = a </b/.source.length"]
]) for(const extension of ["vibe","vibex"]) {
 const cwd=join(dir,"out",key+"-"+extension);mkdirSync(cwd,{recursive:true})
 writeFileSync(join(cwd,"main."+extension),source)
 writeFileSync(join(cwd,"tsconfig.json"),JSON.stringify({compilerOptions:{jsx:"preserve",module:"esnext",noCheck:true,noEmit:true,types:[]},files:["main."+extension]}))
 const r=spawnSync(compiler,["-p",cwd,"--pretty","false"],{encoding:"utf8",timeout:60000})
 assert.notEqual(r.status,null,r.error?.message)
 assert.equal(r.status===0,extension==="vibe",key+"."+extension+"\n"+r.stdout+r.stderr)
}

console.log("VIP-39 PASS")

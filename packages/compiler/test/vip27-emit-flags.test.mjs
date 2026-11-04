// docs/design/vips/0027-declaration-output.md#c9b0d0d57a7330d8
// VIP-27: ordinary noEmit/declaration flags preserve the independent sidecar.
// docs/design/vips/0027-declaration-output.md#8bbc40fc4488bd77
// VIP-27: ordinary noEmit/declaration flags preserve the independent sidecar.
// VIP-27: ordinary emit flags and the independent compatibility-sidecar write.
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {fileURLToPath} from "node:url"
import test from "node:test"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
assert.equal(ts.version,"5.9.3")
assert.ok(process.env.VIBELANG_BINARY,"VIBELANG_BINARY must name the workspace compiler")
const stock=fileURLToPath(new URL("../../../docs/tools/node_modules/typescript/bin/tsc",import.meta.url))
for(const noEmit of [false,true])for(const declaration of [false,true]){
 test("VIP-27 ordinary output flags noEmit="+noEmit+" declaration="+declaration,t=>{
  for(const suffix of [".ts",".vibe"]){
   const root=mkdtempSync(join(tmpdir(),"vip27-output-flags-"))
   t.after(()=>rmSync(root,{recursive:true,force:true}))
   mkdirSync(join(root,"src"))
   writeFileSync(join(root,"package.json"),'{"type":"module"}')
   writeFileSync(join(root,"src/main"+suffix),"export const value = 7;\n")
   writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",strict:true,skipLibCheck:true,types:[],rootDir:"src",outDir:"out",noEmit,declaration},files:["src/main"+suffix],vibe:{effectGlobals:false,effectModules:false}}))
   const args=suffix===".ts"?[stock,"-p",".","--pretty","false"]:["-p",".","--pretty","false"]
   const r=spawnSync(suffix===".ts"?process.execPath:process.env.VIBELANG_BINARY,args,{cwd:root,encoding:"utf8",timeout:30000})
   assert.ifError(r.error);assert.equal(r.status,0,suffix+": "+r.stdout+r.stderr)
   assert.equal(existsSync(join(root,"out/main.js")),!noEmit,suffix+" ordinary JavaScript")
   assert.equal(existsSync(join(root,"out/main.d.ts")),!noEmit&&declaration,suffix+" public declarations")
   if(suffix===".vibe"){
    const sidecar=join(root,"src/main.d.vibe.ts")
    assert.ok(existsSync(sidecar),"compatibility sidecar is independent of both ordinary flags")
    assert.match(readFileSync(sidecar,"utf8"),/export declare const value(?: =|:) 7;/)
   }
  }
 })
}

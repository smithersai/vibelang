import assert from "node:assert/strict"
import { mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname,join,posix } from "node:path"
import { createHash } from "node:crypto"
import { routeBundledImports } from "../../../../../../.smithers/flows/migrate/lib/bundled-imports.mjs"
import { withPackingScope } from "../../../../../../.smithers/flows/migrate/lib/pack-policy.mjs"
import { foreignChanges } from "../../../../../../.smithers/flows/migrate/lib/touched.mjs"
import { packageScriptProofs } from "../../../../../../.smithers/flows/migrate/lib/package-script-scope.mjs"

const root=process.cwd(), [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&31
const ts=createRequire(join(root,"docs/tools/package.json"))("typescript")
const fixture=JSON.parse(readFileSync(join(root,"typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-script-generated-map-authority.json"),"utf8"))
mkdirSync(join(root,".cache"),{recursive:true})
const temporary=mkdtempSync(join(root,".cache/manifest-authority-"))
const put=(file,text)=>{mkdirSync(dirname(join(temporary,file)),{recursive:true});writeFileSync(join(temporary,file),text)}
try {
 const dir=mode&2?"packages/nested":"packages/app",manifest=dir+"/package.json"
 const folder=mode&1?"src/space δ":"src",stem=folder+"/run",leafStem=folder+"/leaf"
 const extension=mode&16?".vibex":".vibe",leaf=dir+"/"+leafStem+extension
 const entry=dir+"/"+stem+".vibe",source=dir+"/"+stem+".ts",consumer=dir+"/src/consumer.ts"
 const output=dir+"/.vibelang/js/"+leafStem+(mode&16?".jsx":".js")
 const script=mode&4?"serve":"start",mapOnly=key==="map-only"||key==="authored-name-map-only"
 const command=suffix=>"node --import vibelang/register "+JSON.stringify(stem+suffix)
 const before={name:"fixture-package",type:"module",scripts:{[script]:command(mapOnly?".vibe":".ts")}}
 put(manifest,JSON.stringify(before,null,mode&8?0:2)+"\n")
 put(entry,fixture.entry)
 put(leaf,fixture.leaf)
 const relative=posix.relative(posix.dirname(consumer),leaf)
 put(consumer,"import { value } from "+JSON.stringify(relative.startsWith(".")?relative:"./"+relative)+";\nexport { value };\n")
 put(output,fixture.output)
 const packages=[{dir,sources:["src"]}]
 const outputs={[leaf]:output}
 let routed={changed:[],modules:[]}
 if(key!=="script-only"){
  routed=routeBundledImports({root:temporary,packages,ts,native:true,outputs})
  assert.ok(routed.changed.includes(manifest),"fixture must actually generate the private map")
  assert.deepEqual(routed.modules,[leaf])
 }
 const after=JSON.parse(readFileSync(join(temporary,manifest),"utf8"))
 if(key!=="script-only"){
  const mapKey="#vibelang/emitted/"+leafStem
  const expectedMap={
   types:"./"+leafStem+".d"+extension+".ts",
   "vibelang-source":"./"+leafStem+extension,
   default:"./.vibelang/js/"+leafStem+(mode&16?".jsx":".js")
  }
  assert.deepEqual(after,{...before,imports:{[mapKey]:expectedMap}},"generated fixture must independently match the documented source/type/runtime targets")
 }

 if(!mapOnly&&key!=="stale-script")after.scripts[script]=command(".vibe")
 if(key==="authored-name"||key==="authored-name-map-only")after.name="changed-authored-name"
 if(key==="changed-dependency")after.dependencies={unrecorded:"1.0.0"}
 const records=routed.changed.length?[{package:".",files:0,code:0,restored:true,packingFiles:routed.changed,routedImports:routed.modules,generatedFiles:[{file:output,sha256:createHash("sha256").update(fixture.output).digest("hex")}]}]:[]
 let codemod={batch:"01",packageScriptEdits:mapOnly?[]:[{manifest,module:entry,script}],emittedJs:[]}
 if(key!=="missing-receipt")codemod=withPackingScope(codemod,records)
 if(key==="missing-receipt")codemod.packageScriptEdits=[]
 const files=mapOnly?[{planned:dir+"/"+leafStem+".ts",path:leaf,migrated:true}]:[{planned:source,path:entry,migrated:key!=="reverted"},{planned:dir+"/"+leafStem+".ts",path:leaf,migrated:true}]
 const batch={files,codemod,manifestSnapshots:{[manifest]:{before:JSON.stringify(before),after:JSON.stringify(after)}}}
 const expectedAllowed=["combined","script-only","map-only"].includes(key)
 const rejected=foreignChanges([{status:"M",path:manifest}],batch)
 const allowed=rejected.length===0
 const proofs=packageScriptProofs(batch)
 console.log(JSON.stringify({ok:allowed===expectedAllowed,key,mode,expectedAllowed,allowed,scriptProofs:proofs.map(p=>p.ok),recordedManifest:codemod.packingFiles?.includes(manifest)??false,routedModules:routed.modules.length,outputSuffix:mode&16?"jsx":"js"}))
} finally {rmSync(temporary,{recursive:true,force:true})}

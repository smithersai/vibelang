import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from "node:fs"
import { dirname,join } from "node:path"
import { buildInventory } from "../../../../../../.smithers/flows/migrate/lib/inventory.mjs"
import { candidates } from "../../../../../../.smithers/flows/migrate/lib/plan.mjs"
import { planScope } from "../../../../../../.smithers/flows/migrate/lib/onepass.mjs"
import { pathReadDeferrals } from "../../../../../../.smithers/flows/migrate/lib/references.mjs"

const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15,root=process.cwd()
const fixture=JSON.parse(readFileSync(new URL("../corpus/t3code-electron-sign-hook-filename.json",import.meta.url),"utf8"))
mkdirSync(join(root,".cache"),{recursive:true})
const temporary=mkdtempSync(join(root,".cache/hook-filenames-"))
try {
 const folder=mode&1?"pkg/nested":"pkg",stem=mode&2?"signatureδ":"windows-jsign"
 const file=folder+"/scripts/lib/"+stem+".ts",caller=folder+"/scripts/build-desktop-artifact.ts"
 const quote=mode&4?"'":'"',newline=mode&8?"\r\n":"\n"
 const source=fixture.source.replaceAll("\n",newline)
 let use="export const signHook = "+quote+"scripts/lib/"+stem+".ts"+quote+newline
 if(key==="bare-hook") use="export const signHook = "+quote+stem+".ts"+quote+newline
 if(key==="ordinary-import") use="import sign from "+quote+"./lib/"+stem+".ts"+quote+"; export {sign}"+newline
 if(key==="unrelated") use="export const signHook = "+quote+"other.ts"+quote+newline
 let observer=fixture.observer.replaceAll("windows-jsign",stem)
 if(key==="bare-hook"||key==="ordinary-import")observer="// No filename assertion.\n"
 if(key==="unrelated")observer=observer.replaceAll(stem,"another-hook")
 if(key==="native-pattern")observer=observer.replace("\\.ts$","\\.(?:ts|vibe)$")
 if(key==="generic-extension")observer="export const select = /\\.tsx?$/\n"
 if(key==="comment-pattern")observer="// "+observer.replaceAll("\n","\n// ")
 if(key==="unrelated"||key==="other-package") {
  observer=observer.replace('import { signHook as hook } from "./build-desktop-artifact.ts"', 'const hook = "scripts/lib/'+(key==="unrelated"?"another-hook":stem)+'.ts"')
 }
 if(key==="path-hook"&&mode===0)assert.equal(use,fixture.caller)
 const testFile=key==="other-package"?"other/test/signing.test.ts":folder+"/scripts/signing.test.ts"
 const files={[file]:source,[caller]:use,[folder+"/ordinary.ts"]:"import { Effect } from 'effect'; export const value = Effect.void\n",[testFile]:observer,[folder+"/package.json"]:JSON.stringify({name:"signing-fixture",type:"module"}),"other/package.json":JSON.stringify({name:"other-fixture",type:"module"})}
 const put=(path,text)=>{mkdirSync(dirname(join(temporary,path)),{recursive:true});writeFileSync(join(temporary,path),text)}
 for(const [path,text] of Object.entries(files))put(path,text)
 const hashes=()=>Object.fromEntries(Object.keys(files).map(path=>[path,createHash("sha256").update(readFileSync(join(temporary,path))).digest("hex")]))
 const before=hashes()
 const inventory=buildInventory({root:temporary,packages:[{dir:folder,sources:["."]}]})
 const inventoryCandidates=candidates(inventory).map(f=>f.path)
 const plan=planScope(temporary,inventoryCandidates)
 const deferrals=pathReadDeferrals(temporary,plan.batches[0].files,Object.keys(files))
 const retained=new Set(deferrals.map(d=>d.file))
 const selected=plan.batches[0].files.filter(f=>!retained.has(f))
 assert.ok(selected.includes(folder+"/ordinary.ts"),"unrelated neighbour must remain eligible")
 assert.equal(inventory.files.find(f=>f.path===file).effect,"values","the witness must be eligible Effect source")
 const wantRetained=key==="path-hook"||key==="bare-hook"
 const observedHook=selected.includes(file)?file.replace(/\.ts$/,".vibe"):file
 const filenamePreserved=observedHook.endsWith("/"+stem+".ts")
 const unchanged=JSON.stringify(before)===JSON.stringify(hashes())
 console.log(JSON.stringify({ok:wantRetained?filenamePreserved:selected.includes(file),unchanged,key,mode,selected,inventoryCandidates,deferrals,file,observedHook,wantRetained,deferral:inventory.files.find(f=>f.path===file).namedBy??null}))
} finally {rmSync(temporary,{recursive:true,force:true})}

// Chapter 007 / loader validation receipt: docs/design/src/007-tooling.md#81f803590b7c4cfb
// Chapter 007 / loader validation receipt: docs/design/src/007-tooling.md#306cfb3f27039261
import assert from "node:assert/strict"
import {mkdirSync,writeFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {checkLoaderRecords} from "../../../../.smithers/flows/migrate/lib/declarations.mjs"
const root=fileURLToPath(new URL("./out/loader-receipts/",import.meta.url))
rmSync(root,{recursive:true,force:true})
const failures=[]
for(const mode of ["missing-module","missing-checker"]){
 const packageDir=join(root,mode);mkdirSync(packageDir,{recursive:true});writeFileSync(join(packageDir,"package.json"),'{"type":"module"}')
 if(mode==="missing-checker"){
  const installed=join(packageDir,"node_modules/vibelang");mkdirSync(installed,{recursive:true})
  writeFileSync(join(installed,"package.json"),JSON.stringify({name:"vibelang",type:"module",exports:{"./project":"./project.mjs"}}))
  writeFileSync(join(installed,"project.mjs"),"export function compileProjectSync(){return {errors:[],warnings:[],outputs:new Map()}}\n")
 }
 const records=[{project:mode+"/tsconfig.json",file:mode+"/.vibelang/record.json",modules:1}]
 const receipt=await checkLoaderRecords({compiler:"unused",packageDir,root,records})
 assert.equal(records[0].modules,1,"do not corrupt the recorded write")
 try {assert.match(JSON.stringify(receipt),/unavailable|unchecked|unsupported|not.checked|not.available/i,mode+": the receipt must distinguish unavailable validation from a checked hit")}catch(error){failures.push(error.message)}
}
assert.deepEqual(failures,[])
console.log("ok")

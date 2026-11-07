import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,rmSync,symlinkSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { dirname,join,resolve } from "node:path"
import { compareDeclarations,recordDeclarationSurface } from "../../../../../../.smithers/flows/migrate/lib/declarations.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const fixture=JSON.parse(readFileSync(new URL("../corpus/t3code-ambient-platform-type-alias.json",import.meta.url),"utf8"))
const [binary,key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&7
mkdirSync(".cache",{recursive:true});const root=mkdtempSync(join(process.cwd(),".cache/ambient-platform-types-"))
const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
try {
 const prefix=mode&4?"nested/":"",normal=text=>(mode&1?text.replaceAll("State","GateState"):text).replaceAll("\n",mode&2?"\r\n":"\n")
 const augmented=!["no-augmentation","changed-type"].includes(key)
 const manifest={name:"ambient-platform-fixture",type:"module",exports:{".":{types:"./dist/"+prefix+"router.d.ts"}}}
 const authored={}
 function snapshot(side) {
  const pkg=join(root,"package-"+side),native=side==="after",body=key!=="plain-native"
  let auth=native&&body?fixture["auth.vibe"]:fixture["auth.ts"],router=fixture["router.ts"]
  if(native)router=router.replaceAll("./auth.ts","./auth.vibe")
  if(!augmented)router=router.replace(/^declare module.*\n/m,"")
  if(native&&key==="changed-type")auth=auth.replaceAll('"ready"','"changed"')
  if(native&&key==="changed-augmentation")router=router.replace("router: typeof router","router: { changed: true }")
  put(join(pkg,"package.json"),JSON.stringify(manifest))
  symlinkSync(resolve(process.env.EFFECT_NODE_MODULES??"experiments/node_modules"),join(pkg,"node_modules"),"dir")
  const files={[prefix+"auth."+(native?"vibe":"ts")]:normal(auth),[prefix+"registry.ts"]:normal(fixture["registry.ts"]),[prefix+"router.ts"]:normal(router)}
  const config={compilerOptions:{target:"ESNext",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],lib:["ESNext"],skipLibCheck:true,rootDir:".",outDir:"dist",declaration:true,emitDeclarationOnly:true,allowArbitraryExtensions:true,allowImportingTsExtensions:true,rewriteRelativeImportExtensions:true},vibe:{effectModules:false,effectGlobals:false},files:Object.keys(files)}
  put(join(pkg,"tsconfig.json"),JSON.stringify(config))
  for(const [name,text] of Object.entries(files)){put(join(pkg,name),text);authored[join(pkg,name)]=text}
  if(!native) {
   const parsed=ts.parseJsonConfigFileContent(config,ts.sys,pkg),program=ts.createProgram(parsed.fileNames,parsed.options)
   const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,"\n")}))
   assert.deepEqual(errors,[],JSON.stringify({side,key,mode,errors}));assert.equal(program.emit().emitSkipped,false)
  } else {
   const run=spawnSync(binary,["-p",join(pkg,"tsconfig.json"),"--singleThreaded","--pretty","false"],{encoding:"utf8",timeout:120000})
   assert.equal(run.status,0,JSON.stringify({side,key,mode,status:run.status,stdout:run.stdout,stderr:run.stderr,error:run.error?.message}))
  }
  const dir=join(pkg,"dist")
  recordDeclarationSurface(ts,dir,pkg,[{tsconfig:"tsconfig.json",prefix:"."}],manifest)
  return dir
 }
 const before=snapshot("before"),after=snapshot("after")
 const tree=()=>{const all={};const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=join(dir,e.name);if(e.isSymbolicLink())all[f.slice(root.length+1)]="link:"+readlinkSync(f);else if(e.isDirectory())walk(f);else all[f.slice(root.length+1)]=createHash("sha256").update(readFileSync(f)).digest("hex")}};walk(root);return all}
 const original=tree(),result=compareDeclarations(ts,before,after,{canonical:true})
 const complete=key!=="changed-augmentation",identical=!["changed-type","changed-augmentation"].includes(key)
 const ok=result.comparisonComplete===complete&&result.identical===identical
 const knownGap=!ok&&key==="module-augmentation"&&result.comparisonComplete===false&&result.identical===false&&result.nameDifferences.length===0&&result.typeDifferences.length===0&&result.docDifferences.length===0&&result.environmentDiagnostics.length>0&&result.environmentDiagnostics.every(d=>d.diagnostic.startsWith("Ambient declaration closures differ"))
 console.log(JSON.stringify({key,mode,ok,knownGap,unchanged:JSON.stringify(original)===JSON.stringify(tree())&&Object.entries(authored).every(([f,text])=>readFileSync(f,"utf8")===text),complete:result.comparisonComplete,identical:result.identical,names:result.nameDifferences,types:result.typeDifferences,docs:result.docDifferences,environment:result.environmentDiagnostics}))
} finally {rmSync(root,{recursive:true,force:true})}

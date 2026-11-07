import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname,join } from "node:path"
import { compareDeclarations,recordDeclarationSurface } from "../../../../../../.smithers/flows/migrate/lib/declarations.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
const fixture=JSON.parse(readFileSync(new URL("../corpus/alchemy-fixed-leaf-wildcard-declarations.json",import.meta.url),"utf8"))
mkdirSync(".cache",{recursive:true});const root=mkdtempSync(join(process.cwd(),".cache/wildcard-declarations-"))
const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
try {
 const prefix=mode&1?"lib/space δ/":"lib/",extension=mode&2?".d.mts":".d.ts"
 const regions=["aws","gcp"],paths=Object.fromEntries(regions.map(r=>[r,r+"/neon"+extension]))
 const beforeFiles=Object.fromEntries(regions.map(r=>[paths[r],fixture.declaration]))
 const afterFiles={...beforeFiles}
 if(key==="changed-type")afterFiles[paths.aws]=afterFiles[paths.aws].replace("value: number","value: string")
 if(key==="changed-doc")afterFiles[paths.aws]=mode&4?"/** Detached module prose. */\n"+afterFiles[paths.aws]:afterFiles[paths.aws].replace("Stable value.","Changed value.")
 if(key==="missing-target")delete afterFiles[paths.gcp]
 const entry=types=>({types,default:types.endsWith(".d.mts")?types.slice(0,-6)+".mjs":types.slice(0,-5)+".js"})
 let exports
 if(key==="fixed-leaf-pattern")exports={"./*/neon":entry("./"+prefix+"*/neon"+extension)}
 else if(key==="whole-path-pattern")exports={"./*":entry("./"+prefix+"*"+extension)}
 else exports=Object.fromEntries(regions.map(r=>["./"+r+"/neon",entry("./"+prefix+paths[r])]))
 const manifest={name:"pattern-fixture",type:"module",exports}
 const normal=text=>mode&8?text.replaceAll("\n","\r\n"):text
 function snapshot(side,files) {
  const dir=join(root,side),pkg=join(root,"source-"+side)
  put(join(pkg,"package.json"),JSON.stringify(manifest))
  put(join(pkg,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],lib:["ES2022"],declaration:true,emitDeclarationOnly:true,rootDir:"src",outDir:prefix},include:["src"]}))
  for(const [file,original] of Object.entries(beforeFiles)) {
   const source=file.endsWith(".d.mts")?file.slice(0,-6)+".mts":file.slice(0,-5)+".ts"
   put(join(pkg,"src",source),normal(files[file]??original))
  }
  for(const [file,contents] of Object.entries(files))put(join(dir,file),normal(contents))
  recordDeclarationSurface(ts,dir,pkg,[{tsconfig:"tsconfig.json",prefix:"."}],manifest)
  return dir
 }
 function stock(side,files) {
  const dir=join(root,"consumer-"+side),pkg=join(dir,"node_modules/pattern-fixture")
  put(join(dir,"package.json"),'{"type":"module"}')
  put(join(pkg,"package.json"),JSON.stringify(manifest))
  for(const [file,text] of Object.entries(files))put(join(pkg,prefix+file),normal(text))
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,types:[],skipLibCheck:false,noEmit:true,lib:["lib.es2022.d.ts"]}
  const resolutions=regions.map(r=>ts.resolveModuleName("pattern-fixture/"+r+"/neon",join(dir,"consumer.ts"),options,ts.sys).resolvedModule?.resolvedFileName??null)
  if(side==="before"||key!=="missing-target")assert.ok(resolutions.every(Boolean),JSON.stringify({key,mode,side,resolutions}))
  else assert.equal(resolutions[1],null)
  if(mode===0) {
   const entry=join(dir,"consumer.ts")
   put(entry,regions.map((r,i)=>'import type { Value as V'+i+' } from "pattern-fixture/'+r+'/neon";\nexport type Export'+i+' = V'+i+';\n').join(""))
   const program=ts.createProgram([entry],options),codes=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>d.code)
   assert.deepEqual([...new Set(codes)].sort(),side==="after"&&key==="missing-target"?[2307]:[],JSON.stringify({side,key,codes}))
  }
  return resolutions
 }
 const nativeBefore=stock("before",beforeFiles),nativeAfter=stock("after",afterFiles)
 const before=snapshot("before",beforeFiles),after=snapshot("after",afterFiles)
 const tree=()=> {
  const files={}
  const walk=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else files[path.slice(root.length+1)]=createHash("sha256").update(readFileSync(path)).digest("hex")}}
  walk(root);return files
 }
 const original=tree()
 const result=compareDeclarations(ts,before,after,{canonical:true})
 const expectedComplete=key!=="missing-target",expectedIdentical=["fixed-leaf-pattern","whole-path-pattern","explicit"].includes(key)
 const ok=result.comparisonComplete===expectedComplete&&result.identical===expectedIdentical
 console.log(JSON.stringify({ok,unchanged:JSON.stringify(original)===JSON.stringify(tree()),key,mode,expectedComplete,expectedIdentical,complete:result.comparisonComplete,identical:result.identical,nativeBefore,nativeAfter,reason:result.incompleteReason??null,names:result.nameDifferences,types:result.typeDifferences,docs:result.docDifferences}))
} finally {rmSync(root,{recursive:true,force:true})}

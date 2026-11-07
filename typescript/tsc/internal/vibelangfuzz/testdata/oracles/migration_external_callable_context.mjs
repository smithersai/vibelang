import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,rmSync,symlinkSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname,join,relative,resolve } from "node:path"
import { compareDeclarations,emitDeclarations,recordDeclarationSurface } from "../../../../../../.smithers/flows/migrate/lib/declarations.mjs"
const dependencies=resolve(process.env.EXTERNAL_CONTEXT_DEPS??"packages/compiler/test/tools/node_modules")
const require=createRequire(join(process.cwd(),"packages/runtime/package.json")),ts=require("typescript")
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
const fixture=JSON.parse(readFileSync(new URL("../corpus/t3code-external-callable-project-context.json",import.meta.url),"utf8"))
mkdirSync(".cache",{recursive:true});const root=mkdtempSync(join(process.cwd(),".cache/external-callable-context-"))
const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
try {
 const project=join(root,"apps/web"),manifest={name:"external-context-fixture",private:true,type:"module"}
 put(join(root,"package.json"),JSON.stringify({private:true,type:"module"}));put(join(project,"package.json"),JSON.stringify(manifest))
 symlinkSync(dependencies,join(root,"node_modules"),"dir");symlinkSync(dependencies,join(project,"node_modules"),"dir")
 const name=mode&8?"nested/entry.ts":"entry.ts",file=mode&1?join(root,"scripts/.api-matrix",name):join(project,".api-matrix",name)
 const config={compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",strict:true,skipLibCheck:true,types:["node"],lib:["ES2022","DOM","DOM.Iterable"],rootDir:mode&2?resolve(project,fixture.project.rootDir):fixture.project.rootDir,composite:false},files:[relative(project,file)],include:[]}
 put(join(project,"tsconfig.api.json"),JSON.stringify(config))
 const module=key==="function-vite"?"vite":fixture.module
 let original=key==="unresolved"?'export declare function plugin(): MissingType;\n':key==="function-primitive"?'export declare function plugin(): number;\n':key==="constant-plugin"?'import type { Plugin } from "'+module+'";\nexport declare const plugin: Plugin;\n':fixture.declaration.replace('"vite-plus"',JSON.stringify(module))
 if(key==="changed-type")original=original.replace("(): Plugin","(): { plugin: Plugin; value: number }")
 const normal=text=>mode&4?text.replaceAll("\n","\r\n"):text
 const compiler=process.env.EXTERNAL_CONTEXT_COMPILER??join(process.cwd(),"packages/compiler/native/vibelang"),sides=[]
 for(const side of ["before","after"]){
  const text=side==="after"&&key==="changed-type"?original.replace("value: number","value: string"):side==="after"&&key==="changed-doc"?original.replace("export declare function","/** Changed exported prose. */\nexport declare function"):original
  put(file,normal(text));const outDir=join(root,side)
  const emitted=await emitDeclarations({compiler,tsconfig:join(project,"tsconfig.api.json"),cwd:project,outDir,log:join(root,side+"-emit.log"),root,typescript:ts})
  assert.equal(emitted.code,key==="unresolved"?2:0,JSON.stringify({side,key,mode,emitted}));assert.equal(emitted.files,1)
  recordDeclarationSurface(ts,outDir,project,[{tsconfig:"tsconfig.api.json",prefix:"."}],manifest)
  sides.push({outDir,emitted})
 }
 const tree=()=>{const all={};const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=join(dir,e.name);if(e.isSymbolicLink())all[f.slice(root.length+1)]="link:"+readlinkSync(f);else if(e.isDirectory())walk(f);else all[f.slice(root.length+1)]=createHash("sha256").update(readFileSync(f)).digest("hex")}};walk(root);return all}
 const before=tree(),result=compareDeclarations(ts,sides[0].outDir,sides[1].outDir,{canonical:true,includePrivate:true}),after=tree()
 const complete=key!=="unresolved",identical=!["unresolved","changed-type","changed-doc"].includes(key)
 const ok=result.comparisonComplete===complete&&result.identical===identical
 const blockers=result.environmentDiagnostics.filter(d=>d.blocking)
 const knownGap=!ok&&Boolean(mode&1)&&["function-plugin","function-vite","changed-type","changed-doc"].includes(key)&&result.comparisonComplete===false&&result.identical===false&&blockers.length>0&&blockers.every(d=>d.entrypoint?.startsWith("scripts/.api-matrix/")&&d.export==="plugin"&&d.diagnostic.startsWith("Compared export depends on an unresolved or erroneous type"))
 console.log(JSON.stringify({key,mode,ok,knownGap,unchanged:JSON.stringify(before)===JSON.stringify(after),complete:result.comparisonComplete,identical:result.identical,expectedComplete:complete,expectedIdentical:identical,emits:sides.map(s=>({code:s.emitted.code,files:s.emitted.files})),environment:result.environmentDiagnostics,names:result.nameDifferences,types:result.typeDifferences,docs:result.docDifferences}))
} finally {rmSync(root,{recursive:true,force:true})}

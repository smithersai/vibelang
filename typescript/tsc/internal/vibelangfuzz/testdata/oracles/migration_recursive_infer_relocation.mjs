import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,rmSync,symlinkSync,writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname,join,resolve } from "node:path"
import { compareDeclarations,recordDeclarationSurface } from "../../../../../../.smithers/flows/migrate/lib/declarations.mjs"
const ts=createRequire(join(process.cwd(),"packages/runtime/package.json"))("typescript")
const fixture=JSON.parse(readFileSync(new URL("../corpus/smithers-recursive-infer-relocation.json",import.meta.url),"utf8"))
const [key,rawMode]=process.argv.slice(2),mode=Number(rawMode)&15
mkdirSync(".cache",{recursive:true});const root=mkdtempSync(join(process.cwd(),".cache/recursive-infer-"))
const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
try {
 const prefix=mode&4?"nested/":""
 const normal=text=>(mode&1?text.replaceAll("Planned.Planned","Plan.Planned").replaceAll("* as Planned","* as Plan"):text).replaceAll("Succeed",mode&8?"Resolve":"Succeed").replaceAll("\n",mode&2?"\r\n":"\n")
 const manifest={name:"recursive-infer-fixture",type:"module",exports:Object.fromEntries(["Node","Planned"].map(name=>["./"+name,{types:"./dist/"+prefix+name+".d.ts"}]))}
 function snapshot(side) {
  const pkg=join(root,"package-"+side),dir=join(root,side),files={...fixture}
  // An explicit export marker keeps the local recursive helper private. The raw
  // declaration control retains TypeScript ambient implicit-export behavior.
  if(key!=="raw-relocated-control")files["Node.d.ts"]+="export {};\n"
  if(side==="after"&&key!=="same-copy") {
   const header='export declare const TypeId: "~Node";\nexport interface Node<out A> { readonly [TypeId]: () => A }\n'
   assert.ok(files["Node.d.ts"].includes(header))
   files["Node.d.ts"]=files["Node.d.ts"].replace(header,'export { TypeId, type Node } from "./Node.vibe.throwing.js";\n')
   files["Node.vibe.throwing.d.ts"]=header
  }
  if(side==="after"&&key==="changed-bigint")files["Node.d.ts"]=files["Node.d.ts"].replace("A extends bigint ? never","A extends bigint ? string")
  put(join(pkg,"package.json"),JSON.stringify(manifest))
  symlinkSync(resolve(process.env.EFFECT_NODE_MODULES??"experiments/node_modules"),join(pkg,"node_modules"),"dir")
  const config={compilerOptions:{target:"ESNext",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:false,types:[],lib:["ESNext"],rootDir:"src",outDir:"dist"},include:["src"]}
  put(join(pkg,"tsconfig.json"),JSON.stringify(config))
  for(const [file,text] of Object.entries(files)){put(join(pkg,"src",prefix+file),normal(text));put(join(pkg,"dist",prefix+file),normal(text));put(join(dir,prefix+file),normal(text))}
  const parsed=ts.parseJsonConfigFileContent(config,ts.sys,pkg),program=ts.createProgram(parsed.fileNames,parsed.options)
  const diagnostics=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,"\n")}))
  assert.deepEqual(diagnostics,[],JSON.stringify({side,key,mode,diagnostics}))
  recordDeclarationSurface(ts,dir,pkg,[{tsconfig:"tsconfig.json",prefix:"."}],manifest)
  return dir
 }
 const before=snapshot("before"),after=snapshot("after")
 const tree=()=>{const all={};const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=join(dir,e.name);if(e.isSymbolicLink())all[f.slice(root.length+1)]="link:"+readlinkSync(f);else if(e.isDirectory())walk(f);else all[f.slice(root.length+1)]=createHash("sha256").update(readFileSync(f)).digest("hex")}};walk(root);return all}
 const original=tree(),result=compareDeclarations(ts,before,after,{canonical:true}),unchanged=JSON.stringify(original)===JSON.stringify(tree())
 const identical=!["changed-bigint","raw-relocated-control"].includes(key)
 const rawNames=key!=="raw-relocated-control"||result.nameDifferences.some(d=>d.export===(mode&8?"ResolveArrayMember":"SucceedArrayMember")&&d.side==="before")
 const ok=result.comparisonComplete===true&&result.identical===identical&&rawNames
 const expectedName=mode&8?"Resolve":"Succeed"
 const knownGap=!ok&&key==="relocated"&&result.comparisonComplete===true&&result.identical===false&&result.nameDifferences.length===0&&result.environmentDiagnostics.length===0&&result.typeDifferences.length===1&&result.typeDifferences[0].export===expectedName
 console.log(JSON.stringify({key,mode,ok,knownGap,unchanged,complete:result.comparisonComplete,identical:result.identical,names:result.nameDifferences,types:result.typeDifferences,environment:result.environmentDiagnostics}))
} finally {rmSync(root,{recursive:true,force:true})}

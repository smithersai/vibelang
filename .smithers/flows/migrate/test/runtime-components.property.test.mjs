import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join,dirname} from "node:path"
import {createRequire} from "node:module"
import {test} from "node:test"
import {fileURLToPath} from "node:url"
import {routeEmittedExports} from "../lib/emitted-exports.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const fc=require("fast-check"),ts=require("typescript")
const put=(r,f,s)=>{mkdirSync(dirname(join(r,f)),{recursive:true});writeFileSync(join(r,f),s)}
const rule="Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."
function scenario({pattern=false,bridge=false,dynamic=false,size=2,style="relative"}={}){
 const root=mkdtempSync(join(tmpdir(),"opencode-runtime-components-"))
 try{
  const original={name:"@demo/plugin",type:"module",exports:pattern?{"./*.js":"./src/*.ts","./a0.js":"./src/a0.ts"}:{"./a0.js":"./src/a0.ts","./effect.js":"./src/effect.ts"}}
  if(!pattern)for(let i=1;i<size;i++)original.exports["./a"+i+".js"]="./src/a"+i+".ts"
  if(style==="imports")original.imports={"#*.js":"./src/*.ts"}
  if(style==="paths")put(root,"tsconfig.json",JSON.stringify({compilerOptions:{paths:{"@/*":["./src/*"]}}}))
  const spec=name=>style==="imports"?"#"+name+".js":style==="self"?"@demo/plugin/"+name+".js":style==="paths"?"@/"+name+".js":"./"+name+".js"
  put(root,"package.json",JSON.stringify(original))
  const outputs={"./src/leaf.vibe":"./.vibelang/js/src/leaf.js"}
  put(root,"src/leaf.vibe",'export { value } from "./a0.ts"\n')
  put(root,".vibelang/js/src/leaf.js",(dynamic?'const target="./effect.js"; import(target);\n':'')+'export { value } from "./a0.js"\n')
  for(let i=0;i<size;i++){
   const name="a"+i,next=i+1<size?'export { value } from "./a'+(i+1)+'.js";\n':'export const value = {};\n'
   put(root,"src/"+name+".ts",next);put(root,".vibelang/js/src/"+name+".js",next);outputs["./src/"+name+".ts"]="./.vibelang/js/src/"+name+".js"
  }
  for(const [source,output] of Object.entries(outputs))if(source.endsWith(".ts")||source.endsWith(".vibe")){
   const text=readFileSync(join(root,output),"utf8").replaceAll(/"(\.\/a\d+\.js)"/g,(_,name)=>JSON.stringify(spec(name.slice(2,-3))))
   put(root,output,text)
  }
  const effect=bridge?'export { value } from "./leaf.js";\n':'export const value = {};\n// import("./leaf.js")\nconst example = \'import("./leaf.js")\';\n'
  put(root,"src/effect.ts",effect);put(root,".vibelang/js/src/effect.js",effect);outputs["./src/effect.ts"]="./.vibelang/js/src/effect.js"
  put(root,"consumer.ts","export {}\n")
  const typeName="@demo/plugin/a"+(size-1)+".js",resolveType=()=>ts.resolveModuleName(typeName,join(root,"consumer.ts"),{moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext},ts.sys).resolvedModule?.resolvedFileName
  const beforeType=pattern?resolveType():undefined
  if(pattern)assert.equal(beforeType,join(root,"src/a"+(size-1)+".ts"))
  let graph
  routeEmittedExports(root,outputs,{onGraph:g=>graph=g})
  const routed=JSON.parse(readFileSync(join(root,"package.json"),"utf8"))
  assert.equal(routed.exports["./a0.js"].default,"./.vibelang/js/src/a0.js")
  const effectEntry=routed.exports["./effect.js"]??routed.exports["./*.js"]
  if(bridge||dynamic)assert.equal(effectEntry.default.replace("*","effect"),"./.vibelang/js/src/effect.js")
  else assert.equal(effectEntry,pattern?"./src/*.ts":"./src/effect.ts")
  assert.ok(graph&&graph.mode===(dynamic?"package":"component"))
  if(pattern)assert.equal(resolveType(),beforeType,"exact wildcard routes retain the native type source")
  const once=readFileSync(join(root,"package.json"),"utf8")
  assert.equal(routeEmittedExports(root,outputs),false)
  assert.equal(readFileSync(join(root,"package.json"),"utf8"),once)
  routeEmittedExports(root,{}, {restore:true})
  assert.deepEqual(JSON.parse(readFileSync(join(root,"package.json"),"utf8")),original)
 }finally{rmSync(root,{recursive:true,force:true})}
}
test("opencode-59: unrelated native Effect facade retains its provided-module resolution",()=>scenario())
test("opencode-59: wildcard routes preserve source fallback and authored exact entries",()=>scenario({pattern:true}))
test("opencode-59: package imports, self exports and paths retain shared components",()=>{
 for(const style of ["imports","self","paths"])for(const pattern of [false,true])scenario({style,pattern,size:3})
})
test("runtime component oracle quotes chapter7",()=>assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md",import.meta.url),"utf8").includes(rule)))
test("property: runtime components preserve shared modules, native paths and exact revert",async()=>checkProperty(fc,{
 name:"runtime-export-components",rule,command:"node --test .smithers/flows/migrate/test/runtime-components.property.test.mjs",regressions:new URL("./corpus/",import.meta.url),numRuns:80,
 arbitrary:fc.record({pattern:fc.boolean(),bridge:fc.boolean(),dynamic:fc.boolean(),size:fc.integer({min:1,max:5}),style:fc.constantFrom("relative","self","imports","paths")}),check:scenario
}))

test("opencode-59: an unchanged Bun host recognizes provided native modules after migration",async()=>{
 const {spawnSync}=await import("node:child_process")
 const {renameBatch,rewriteExports}=await import("../lib/codemod.mjs")
 const {emitPackageJs}=await import("../lib/declarations.mjs")
 const {symlinkSync}=await import("node:fs")
 const compiler=process.env.VIBELANG_BINARY??fileURLToPath(new URL("../../../../packages/compiler/native/vibelang",import.meta.url))
 const root=mkdtempSync(join(tmpdir(),"opencode-provided-host-"))
 try{
  put(root,"package.json",JSON.stringify({name:"@demo/plugin",type:"module",exports:{"./*.js":"./src/*.ts"}}))
  put(root,"tsconfig.json",JSON.stringify({compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",strict:true,skipLibCheck:true,types:[],rewriteRelativeImportExtensions:true,noEmit:true},vibe:{effectGlobals:false,effectModules:false},include:["src"]}))
  put(root,"src/leaf.ts",'export { token } from "./token.ts"\n')
  put(root,"src/token.ts","export const token: object = {}\n")
  put(root,"src/effect.ts","export const provided = 42\n")
  const host='import assert from "node:assert/strict"; import {token as a} from "@demo/plugin/token.js"; import {token as b} from "@demo/plugin/leaf.js"; assert.equal(a,b); assert.ok(Bun.resolveSync("@demo/plugin/effect.js",import.meta.dirname).endsWith("/src/effect.ts"));\n'
  put(root,"host.mjs",host);mkdirSync(join(root,"node_modules/@demo"),{recursive:true});symlinkSync(root,join(root,"node_modules/@demo/plugin"))
  const run=()=>{const r=spawnSync("bun",["host.mjs"],{cwd:root,encoding:"utf8",timeout:30000});assert.equal(r.status,0,(r.stdout??"")+(r.stderr??""))}
  run()
  const renames=renameBatch(root,["src/leaf.ts"]);rewriteExports(root,renames)
  const emitted=await emitPackageJs({compiler,tsconfigs:[join(root,"tsconfig.json")],packageDir:root,root,log:join(root,"emit.log")})
  assert.equal(emitted.code,0,readFileSync(join(root,"emit.log"),"utf8"))
  let routing
  routeEmittedExports(root,emitted.outputs,{onGraph:g=>routing=g})
  assert.equal(readFileSync(join(root,"host.mjs"),"utf8"),host)
  run()
  assert.equal(routing.mode,"component");assert.equal(routing.selected,2)
 }finally{rmSync(root,{recursive:true,force:true})}
})

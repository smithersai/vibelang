import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const header="/** Canonical original header */\n"
const unused='import {Effect} from "effect";\n'
const body="export interface Canonical { readonly value:string }\n"
function workspace(t){
 const root=mkdtempSync(join(tmpdir(),"chapter007-header-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,"node_modules"));symlinkSync(join(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"),"effect"),join(root,"node_modules/effect"))
 writeFileSync(join(root,"package.json"),'{"type":"module"}')
 return root
}
// native emits main.<extension>'s declaration with the vibelang compiler.
function native(root,extension,text){
 const dir=mkdtempSync(join(root,"case-")),file=join(dir,"main."+extension);writeFileSync(file,text)
 const r=spawnSync(binary,["--target","es2022","--module","nodenext","--strict","--types","","--declaration","--emitDeclarationOnly","--outDir",join(dir,"out"),file],{cwd:root,encoding:"utf8"})
 assert.equal(r.status,0,r.stdout+r.stderr)
 return readFileSync(join(dir,"out/main.d.ts"),"utf8")
}
function stock(root,text){
 const file=join(root,"stock.ts");writeFileSync(file,text)
 const p=ts.createProgram([file],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,types:[],declaration:true,emitDeclarationOnly:true})
 assert.deepEqual(ts.getPreEmitDiagnostics(p).map(d=>d.code),[])
 const outputs=[];assert.equal(p.emit(undefined,(name,text)=>outputs.push(text)).emitSkipped,false);assert.equal(outputs.length,1)
 return outputs[0]
}
// Chapter 007 / first-import comment attachment and native elision: docs/design/src/007-tooling.md#46110484ebf74536
// The header comment attaches to the first import, so eliding an unused
// first import drops it; without that import the header stays. The vibelang
// compiler does this for .ts and .vibe, and matches stock tsc on .ts.
for(const extension of ["ts","vibe"]){
 test("Chapter 007 / native declaration elision distinguishes a first unused import header on ."+extension,t=>{
  const root=workspace(t)
  const original=native(root,extension,header+unused+body),removed=native(root,extension,header+body)
  assert.doesNotMatch(original,/Canonical original header/)
  assert.match(removed,/Canonical original header/)
  assert.match(original,/export interface Canonical/)
  assert.equal(original,stock(root,header+unused+body))
  assert.equal(removed,stock(root,header+body))
 })
}

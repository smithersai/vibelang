import assert from "node:assert/strict"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
// Chapter 007 / first-import comment attachment and native elision: docs/design/src/007-tooling.md#46110484ebf74536
test("Chapter 007 / native declaration elision distinguishes a first unused import header",t=>{
 const root=mkdtempSync(join(tmpdir(),"chapter007-header-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,"node_modules"));symlinkSync(join(process.env.EFFECT_TWIN_NODE_MODULES||process.env.EFFECT_NODE_MODULES,"effect"),join(root,"node_modules/effect"))
 writeFileSync(join(root,"package.json"),'{"type":"module"}')
 const header="/** Canonical original header */\n"
 const unused='import {Effect} from "effect";\n'
 const body="export interface Canonical { readonly value:string }\n"
 function emit(text){
  const file=join(root,"main.ts");writeFileSync(file,text)
  const p=ts.createProgram([file],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,types:[],declaration:true,emitDeclarationOnly:true})
  const outputs=[]
  assert.deepEqual(ts.getPreEmitDiagnostics(p).map(d=>d.code),[])
  const result=p.emit(undefined,(name,text)=>outputs.push(text))
  assert.equal(result.emitSkipped,false);assert.equal(outputs.length,1);return outputs[0]
 }
 const original=emit(header+unused+body),removed=emit(header+body)
 assert.doesNotMatch(original,/Canonical original header/)
 assert.match(removed,/Canonical original header/)
 assert.notEqual(original,removed)
})

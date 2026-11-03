// VIP-39 stock collision reference: docs/design/vips/0039-vibex.md#f85126f669fd4d69
// VIP-39 stock collision reference: docs/design/vips/0039-vibex.md#d3c48b682dbd18e1
// VIP-39 stock collision reference: docs/design/vips/0039-vibex.md#6a4bffb3666c942c
import assert from "node:assert/strict"
import {test} from "node:test"
import ts from "typescript"

function compile(options) {
 const root="/vibex-native-reference"
 const files=new Map([[root+"/App.ts","export const plain=1"],[root+"/App.tsx","export const jsx=2"]])
 const written=new Map()
 const settings={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.Preserve,outDir:root+"/out",types:[],skipLibCheck:true,...options}
 const host=ts.createCompilerHost(settings)
 const original={getSourceFile:host.getSourceFile.bind(host),fileExists:host.fileExists.bind(host),readFile:host.readFile.bind(host)}
 host.getSourceFile=(name,language,...rest)=>files.has(name)?ts.createSourceFile(name,files.get(name),language,true):original.getSourceFile(name,language,...rest)
 host.fileExists=name=>files.has(name)||original.fileExists(name)
 host.readFile=name=>files.get(name)??original.readFile(name)
 host.writeFile=(name,text)=>written.set(name,text)
 const program=ts.createProgram([...files.keys()],settings,host)
 const diagnostics=ts.getPreEmitDiagnostics(program)
 program.emit()
 return {diagnostics,written}
}
const controls=[
 ["preserve without declarations",{},[],["App.js","App.jsx"]],
 ["preserve with declarations",{declaration:true},["App.d.ts"],[]],
 ["React without declarations",{jsx:ts.JsxEmit.React},["App.js"],[]],
 ["declarations only",{declaration:true,emitDeclarationOnly:true},["App.d.ts"],[]],
 ["React noEmit",{jsx:ts.JsxEmit.React,noEmit:true},[],[]]
]
for(const [name,options,collisions,outputs] of controls) test("VIP-39 native collision control: "+name,()=>{
 assert.equal(ts.version,"5.9.3")
 const {diagnostics,written}=compile(options)
 assert.deepEqual(diagnostics.map(d=>d.code),collisions.map(()=>5056))
 for(const path of collisions) assert.ok(diagnostics.some(d=>ts.flattenDiagnosticMessageText(d.messageText," ").includes("/"+path)),path)
 if(!collisions.length) assert.deepEqual([...written.keys()].map(p=>p.split("/").at(-1)).sort(),outputs.sort())
})

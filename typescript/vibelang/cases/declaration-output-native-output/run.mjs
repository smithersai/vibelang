import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
assert.equal(ts.version,"5.9.3")
for(const suffix of [".vibe",".vibex"])for(const native of [".ts",".tsx"]){
 const dir=mkdtempSync(join(tmpdir(),"vip27-native-output-"))
 try{
  writeFileSync(join(dir,"package.json"),'{"type":"module"}')
  writeFileSync(join(dir,"producer"+suffix),"export const value = 42 as const;")
  writeFileSync(join(dir,"producer.d"+suffix+".ts"),"export declare const value:42;")
  writeFileSync(join(dir,"consumer"+native),'import {value} from "./producer'+suffix+'"; export const answer:42 = value;')
  const options={target:"ES2022",module:"NodeNext",jsx:"preserve",allowArbitraryExtensions:true,types:[],strict:true,outDir:"out"}
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:options,files:["consumer"+native],vibe:{effectGlobals:false,effectModules:false}}))
  const result=spawnSync(process.env.VIBELANG_BINARY,["-p",".","--pretty","false"],{cwd:dir,encoding:"utf8",timeout:30000})
  assert.ifError(result.error)
  if(result.status!==0){
   const codes=[...(result.stdout+result.stderr).matchAll(/error ((?:TS|EK)\d+):/g)].map(m=>m[1])
   assert.ok(codes.length>0&&codes.every(c=>c==="TS5097"),result.stdout+result.stderr)
   console.error(JSON.stringify({stage:"known-admission-gap",suffix,native,codes,coveredBy:"declaration-output-native-consumers"}))
  }
  const output="consumer"+(native===".tsx"?".jsx":".js")
  const imports=file=>ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true).statements.filter(ts.isImportDeclaration).map(s=>s.moduleSpecifier.text)
  assert.deepEqual(imports(join(dir,"out",output)),["./producer"+(suffix===".vibex"?".jsx":".js")])
  const stock=ts.createProgram([join(dir,"consumer"+native)],{...ts.convertCompilerOptionsFromJson(options,dir).options,outDir:join(dir,"stock")})
  assert.deepEqual(ts.getPreEmitDiagnostics(stock).map(d=>d.code),[])
  stock.emit()
  assert.deepEqual(imports(join(dir,"stock",output)),["./producer"+suffix])
 }finally{rmSync(dir,{recursive:true,force:true})}
}
console.log("native consumer output names")

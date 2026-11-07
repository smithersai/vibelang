import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join,dirname} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
import fc from "fast-check"
import {typedProgram} from "../../eslint.mjs"
const repo=fileURLToPath(new URL("../../../../",import.meta.url))
function check(ext, relocated, twin, suffix) {
 const dir=mkdtempSync(join(tmpdir(),"typed-native-"))
 try {
  symlinkSync(join(repo,"packages/compiler/test/eslint/node_modules"),join(dir,"node_modules"))
  const files={
   "package.json":'{"name":"typed-native","type":"module"}',
   "tsconfig.json":JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:true,noEmit:true,types:[],allowArbitraryExtensions:true,jsx:"preserve",rootDir:".",...(relocated?{rootDirs:[".",".vibe/declarations"]}:{})},...(relocated?{vibe:{sidecarDir:".vibe/declarations"}}:{}),include:["src"]}),
   ["src/value"+suffix+ext]:'export type Value = string\n',
   ["src/box"+suffix+ext]:'import type {Value} from "./value'+suffix+ext+'"\nexport interface Box {readonly items: ReadonlyArray<Value>}\nexport function make(items: ReadonlyArray<Value>): Box {return {items}}\n',
   "src/main.ts":'import {make, type Box} from "./box'+suffix+ext+'"\nexport const head = (box: Box): string => box.items[0]!\nexport const made: string = head(make(["good"]))\n'
  }
  if(twin)files["src/value"+suffix+(ext===".vibex"?".tsx":".ts")]="export type Value = number\n"
  for(const [name,text] of Object.entries(files)){mkdirSync(dirname(join(dir,name)),{recursive:true});writeFileSync(join(dir,name),text)}
  const p=typedProgram({project:"tsconfig.json",tsconfigRootDir:dir})
  const ds=p.getSemanticDiagnostics()
  assert.deepEqual(ds.map(d=>({code:d.code,message:d.messageText})),[])
  const file=p.getSourceFile(join(dir,"src/main.ts"))
  const checker=p.getTypeChecker(),head=file.statements[1].declarationList.declarations[0]
  assert.equal(checker.typeToString(checker.getTypeAtLocation(head.name)),"(box: Box) => string")
 } finally {rmSync(dir,{recursive:true,force:true})}
}
test("typed lint preserves native declaration imports, twins and relocated sidecars", () => {
fc.assert(fc.property(fc.constantFrom(".vibe",".vibex"),fc.boolean(),fc.boolean(),fc.integer({min:0,max:999}),check),{seed:270617,numRuns:12})
}, 60_000)


test("typed lint rejects an invalid producer even when declarations can be emitted", () => {
 const dir=mkdtempSync(join(tmpdir(),"typed-native-invalid-"))
 try {
  symlinkSync(join(repo,"packages/compiler/test/eslint/node_modules"),join(dir,"node_modules"))
  mkdirSync(join(dir,"src"))
  writeFileSync(join(dir,"package.json"),'{"type":"module"}')
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,noEmit:true,types:[],skipLibCheck:true},include:["src"]}))
  writeFileSync(join(dir,"src/value.vibe"),'export const value: number = "wrong"\n')
  writeFileSync(join(dir,"src/main.ts"),'import {value} from "./value.vibe"; export const kept = value\n')
  assert.throws(()=>typedProgram({project:"tsconfig.json",tsconfigRootDir:dir}),/did not compile/)
 } finally {rmSync(dir,{recursive:true,force:true})}
}, 60_000)

// run-seconds: 120
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from "node:fs"
import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const require=createRequire(join(repo,"packages/runtime/package.json"))
const root=mkdtempSync(join(tmpdir(),"fork-native-assignability-"))
try{
 mkdirSync(join(root,"node_modules"))
 symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(root,"node_modules/effect"))
 writeFileSync(join(root,"package.json"),'{"type":"module"}')
 writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,types:[],skipLibCheck:true,target:"ES2022",module:"NodeNext",noEmit:true},files:["main.ts"]}))
 const expressions=["{value:1}","{}","{value}","{[name]:value}","{...object}","{get value(){return 1}}","{value(){return 1}}"]
 const source='import type * as Effect from "effect/Effect";const value=1;const name="item";const object={value:1};type IsEffect<T>=T extends Effect.Effect<any,any,any>?true:false;\n'+expressions.map((expression,n)=>"export const operand"+n+"="+expression+";const proof"+n+":IsEffect<typeof operand"+n+">=false;").join("\n")
 const check=text=>{
  writeFileSync(join(root,"main.ts"),text)
  const r=spawnSync(process.execPath,[require.resolve("typescript/bin/tsc"),"-p",join(root,"tsconfig.json"),"--pretty","false"],{encoding:"utf8",timeout:30000})
  assert.equal(r.error,undefined);assert.equal(r.signal,null)
  return {...r,output:r.stdout+r.stderr}
 }
 const valid=check(source)
 assert.equal(valid.status,0,valid.output)
 const invalid=check(source+"\nexport const invalid={value():number{return 'invalid'}}")
 assert.notEqual(invalid.status,0,invalid.output)
 assert.deepEqual([...invalid.output.matchAll(/error (TS[0-9]+):/g)].map(m=>m[1]),["TS2322"])
}finally{rmSync(root,{recursive:true,force:true})}
console.log("fork operand assignability agrees")

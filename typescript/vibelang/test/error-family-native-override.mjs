import assert from "node:assert/strict"
import {mkdtempSync,writeFileSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {spawnSync} from "node:child_process"
import {createRequire} from "node:module"
const require=createRequire(new URL("../../../packages/runtime/package.json",import.meta.url))
const stock=require.resolve("typescript/bin/tsc")
for(const [base,child] of [["Parent","Child"],["Failure","Missing"],["Root","Leaf"]])for(const wide of [false,true]){
 const directory=mkdtempSync(join(tmpdir(),"native-tag-override-"))
 try{
  const source='class Parent {readonly _tag: '+(wide?"string":JSON.stringify(base))+'='+JSON.stringify(base)+'}\nclass Child extends Parent {override readonly _tag: '+JSON.stringify(child)+'='+JSON.stringify(child)+'}'
  writeFileSync(join(directory,"main.ts"),source)
  writeFileSync(join(directory,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",strict:true,noEmit:true,types:[]},files:["main.ts"]}))
  const result=spawnSync(process.execPath,[stock,"-p",directory,"--pretty","false"],{encoding:"utf8",timeout:30000})
  assert.ifError(result.error)
  assert.equal(result.status,wide?0:2,result.stdout+result.stderr)
  const codes=[...result.stdout.matchAll(/error (TS\d+):/g)].map(match=>match[1])
  assert.deepEqual(codes,wide?[]:["TS2416"])
 }finally{rmSync(directory,{recursive:true,force:true})}
}
console.log("stock TypeScript retains literal-tag override errors and accepts wide roots")

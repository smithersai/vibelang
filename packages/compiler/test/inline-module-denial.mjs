import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const stock=join(repo,"docs/tools/node_modules/typescript/bin/tsc")
export const inlineKey=input=>input.literal?"alchemy-pem-throw-reexport":input.name+":"+input.body
export const inlineInputs=()=>["pem","Legacy","escape"].flatMap(name=>["function","const","class"].map(body=>({name,body})))
function bodyOf(input){
  return {
    function:'export function b(x: string): string { return x }',
    const:'export const b = 1',
    class:'export class b { readonly value = 1 }',
  }[input.body]
}
export function inspectInline(input,literal){
  const root=mkdtempSync(join(tmpdir(),"vibelang-inline-denial-"))
  try{
    const nm=join(root,"node_modules");mkdirSync(nm)
    symlinkSync(join(repo,"experiments/node_modules/effect"),join(nm,"effect"))
    symlinkSync(join(repo,"packages/runtime"),join(nm,"vibelang-runtime"))
    writeFileSync(join(root,"package.json"),'{"type":"module"}')
    const source=literal||"module "+input.name+" { "+bodyOf(input)+" }\nimport { b } from "+input.name+"\nexport { b }\n"
    const run=(file,text,nativeStock=false)=>{
      writeFileSync(join(root,file),text)
      writeFileSync(join(root,"tsconfig.json"),JSON.stringify({
        compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:true,types:[],noEmit:true},
        files:[file],
      }))
      const result=spawnSync(nativeStock?process.execPath:binary,[...(nativeStock?[stock]:[]),"-p",join(root,"tsconfig.json"),"--pretty","false"],{cwd:root,encoding:"utf8",timeout:120000,env:{...process.env,GOMAXPROCS:"2"}})
      assert.ifError(result.error)
      assert.equal(result.signal,null,"compiler termination cannot establish a language result")
      const output=(result.stdout||"")+(result.stderr||"")
      return {status:result.status,codes:[...output.matchAll(/error ((?:TS|EK)\d+):/g)].map(m=>m[1]),output:output.replaceAll(root,"<project>")}
    }
    if(!literal){
      const native=run("control.ts","namespace "+input.name+" { "+bodyOf(input)+" }\nexport const value = "+input.name+".b;\n")
      assert.equal(native.status,0,"invalid ordinary namespace counterpart: "+native.output)
      const namespace=run("namespace.ts","namespace "+input.name+" { "+bodyOf(input)+" }\nexport const value = "+input.name+".b;\n",true)
      assert.equal(namespace.status,0,"stock TypeScript rejects the namespace control: "+namespace.output)
    }
    const rejected=run("main.ts",source)
    assert.ok(rejected.codes.includes("TS1141"),"ordinary TypeScript must reject the identifier module specifier")
    const stockRejected=run("stock.ts",source,true)
    assert.ok(stockRejected.codes.includes("TS1141"),"stock TypeScript must reject the identifier module specifier: "+stockRejected.output)
    const body=literal?literal.match(/^module \w+ \{ ([\s\S]*) \}\nimport /)?.[1]:bodyOf(input)
    assert.ok(body,"the minimized module body must be extracted unchanged")
    const extracted=run("body.ts",body,true)
    assert.equal(extracted.status,0,"stock TypeScript rejects the extracted body: "+extracted.output)
    const vibe=run("main.vibe",source)
    return {key:inlineKey(input),vibe,native:rejected,stock:stockRejected,extracted}
  }finally{rmSync(root,{recursive:true,force:true})}
}

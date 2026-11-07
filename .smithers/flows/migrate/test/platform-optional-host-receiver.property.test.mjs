import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import { test } from "node:test"
import { splitPlatformToModule } from "../lib/platform.mjs"
import { materialize } from "./helpers/host-operations-oracle.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/t3code-optional-host-receiver.json",import.meta.url),"utf8"))
const split=(source,globals=["process"])=>splitPlatformToModule(source,"capture.ts",ts,{globals})
const js=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText

test("t3code optional getuid read keeps its class and module identity",()=>{
  const result=split(corpus.source)
  assert.ok(result && !result.refused,JSON.stringify(result))
  const {body,module}=materialize(result.module,"./host.platform.js")
  assert.match(body,/return process\.getuid\?\.\(\)/)
  assert.doesNotMatch(body,/import\.meta/)
  assert.match(module,/class CaptureShortcutConfig/)
  assert.match(module,/origin = import\.meta\.url/)
})

test("optional calls with arguments still refuse an unproved evaluation-order move",()=>{
  const source=corpus.source.replace("process.getuid?.()","process.stdout.write?.(import.meta.url)")
  assert.match(split(source).refused,/receiver/)
})

test("optional zero-argument host calls retain public declaration types",()=>{
  const result=split(corpus.source)
  assert.ok(result && !result.refused,JSON.stringify(result))
  const {body,module}=materialize(result.module,"./host.platform.js")
  const options={strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,types:[],declaration:true,emitDeclarationOnly:true}
  const root=mkdtempSync(join(tmpdir(),"optional-declaration-"))
  try {
    const emit=files=>{
      const virtual=Object.fromEntries(Object.entries(files).map(([file,text])=>[join(root,file),text]))
      const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host),get=host.getSourceFile.bind(host)
      host.readFile=file=>virtual[file]??read(file);host.fileExists=file=>Object.hasOwn(virtual,file)||exists(file)
      host.getSourceFile=(file,language,...rest)=>Object.hasOwn(virtual,file)?ts.createSourceFile(file,virtual[file],language,true):get(file,language,...rest)
      const output={}
      host.writeFile=(file,text)=>output[relative(root,file)]=text
      const program=ts.createProgram(Object.keys(virtual),options,host)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,"\n")})),[])
      assert.equal(program.emit().emitSkipped,false)
      return output
    }
    const ambient='declare const process: { getuid?: () => number };\n'
    const before=emit({"capture.ts":corpus.source,"ambient.d.ts":ambient})
    const after=emit({"capture.ts":module,"host.platform.ts":body,"ambient.d.ts":ambient})
    assert.equal(after["capture.d.ts"],before["capture.d.ts"])
  } finally {rmSync(root,{recursive:true,force:true})}
})

test("optional host receivers keep getters, absence, throws and laziness",async()=>{
  const root=mkdtempSync(join(tmpdir(),"optional-host-")),saved=Object.getOwnPropertyDescriptor(globalThis,"OptionalHost")
  try {
    const source=corpus.source.replaceAll("process.getuid","OptionalHost.read")
    const result=split(source,["OptionalHost"])
    assert.ok(result && !result.refused,JSON.stringify(result))
    const {body,module}=materialize(result.module,"./host.platform.js")
    writeFileSync(join(root,"package.json"),'{"type":"module"}')
    writeFileSync(join(root,"before.js"),js(source));writeFileSync(join(root,"after.js"),js(module));writeFileSync(join(root,"host.platform.js"),js(body))
    const before=await import(pathToFileURL(join(root,"before.js"))),after=await import(pathToFileURL(join(root,"after.js")))
    await fc.assert(fc.asyncProperty(fc.constantFrom("present","absent","null","nonCallable","throw","getterThrow"),fc.integer(),async(mode,value)=>{
      const evaluate=Constructor=>{
        const events=[],host={}
        Object.defineProperty(host,"read",{get(){
          events.push("get")
          if(mode==="getterThrow")throw new Error("getter")
          if(mode==="absent")return undefined
          if(mode==="null")return null
          if(mode==="nonCallable")return 17
          return function(){events.push(this===host?"receiver":"wrong receiver");if(mode==="throw")throw new Error("call");return value}
        }})
        Object.defineProperty(globalThis,"OptionalHost",{value:host,configurable:true})
        const instance=new Constructor()
        assert.deepEqual(events,[],"constructing the class does not read or call the optional member")
        try{return {value:instance.read(),events}}catch(error){return {error:error.message,events}}
      }
      assert.deepEqual(evaluate(after.CaptureShortcutConfig),evaluate(before.CaptureShortcutConfig))
    }),{seed:44021436,numRuns:50})
  }finally{if(saved)Object.defineProperty(globalThis,"OptionalHost",saved);else delete globalThis.OptionalHost;rmSync(root,{recursive:true,force:true})}
})

test("optional calls with local type arguments remain refused",()=>{
  const source='export class Capture { readonly origin=import.meta.url; read<T>() { return OptionalHost.read?.<T>(); } }'
  assert.match(split(source,["OptionalHost"]).refused,/receiver/)
})

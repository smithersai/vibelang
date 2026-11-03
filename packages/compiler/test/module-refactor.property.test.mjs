import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")

// Same stdio framing as lsp-format.test.mjs; all requests have bounded deadlines.
function connection(cwd) {
  const child = spawn(binary, ["--lsp", "--stdio"], {cwd, stdio:["pipe","pipe","pipe"]})
  let buffer = Buffer.alloc(0), next = 1, stderr = ""
  const pending = new Map()
  const send = message => {
    const body = Buffer.from(JSON.stringify({jsonrpc:"2.0", ...message}))
    child.stdin.write("Content-Length: " + body.length + "\r\n\r\n")
    child.stdin.write(body)
  }
  child.stderr.on("data", data => { stderr += data })
  child.stdout.on("data", data => {
    buffer = Buffer.concat([buffer,data])
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n")
      if (end < 0) return
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0,end).toString())[1])
      if (buffer.length < end + 4 + length) return
      const message = JSON.parse(buffer.subarray(end+4,end+4+length))
      buffer = buffer.subarray(end+4+length)
      if (message.method && message.id !== undefined) {
        send({id:message.id,result:message.method === "workspace/configuration" ? message.params.items.map(()=>null) : null})
      } else if (pending.has(message.id)) {
        const {resolve,reject,timer} = pending.get(message.id)
        pending.delete(message.id); clearTimeout(timer)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      }
    }
  })
  const fail = error => {
    for (const item of pending.values()) {clearTimeout(item.timer); item.reject(error)}
    pending.clear()
  }
  child.on("error",fail)
  child.on("exit",(code,signal)=>fail(new Error("LSP exited: " + code + " " + signal + " " + stderr)))
  return {
    notify:(method,params)=>send({method,params}),
    request(method,params) {
      const id = next++
      return new Promise((resolve,reject)=>{
        const timer = setTimeout(()=>{pending.delete(id);reject(new Error(method + " timed out: " + stderr))},60000)
        pending.set(id,{resolve,reject,timer}); send({id,method,params})
      })
    },
    kill() {child.kill("SIGKILL"); for (const item of pending.values()) clearTimeout(item.timer)}
  }
}

function apply(source, edits) {
  const offset = pos => source.split("\n").slice(0,pos.line).reduce((n,line)=>n+line.length+1,0)+pos.character
  const sorted = [...edits].sort((a,b)=>offset(b.range.start)-offset(a.range.start))
  let previous = source.length
  for (const edit of sorted) {
    const start=offset(edit.range.start), end=offset(edit.range.end)
    assert.ok(start <= end && end <= previous, "edits overlap or leave their source")
    source=source.slice(0,start)+edit.newText+source.slice(end)
    previous=start
  }
  return source
}

function run(command,args,cwd) {
  const result=spawnSync(command,args,{cwd,encoding:"utf8",timeout:60000})
  assert.ifError(result.error)
  assert.equal(result.status,0,result.stdout+result.stderr)
  return result.stdout
}

async function check(input) {
  const root=mkdtempSync(join(tmpdir(),"vibelang-module-refactor-"))
  let client
  try {
    const extension=input.ts ? ".ts" : ".js"
    const source=[
      "// café 😀",
      "module " + input.name + " {",
      "  export let value: number = " + input.value,
      "  /** @throws {never} */",
      "  export function bump(): number { return ++value }",
      "  export const text: string = `first",
      "    second",
      "  `",
      "}",
      "import { value, bump, text } from " + input.name,
      "export { bump } from " + input.name,
      "export function read(): readonly (number | string)[] { return [value, bump(), value, text] }",
      ""
    ].join("\n")
    writeFileSync(join(root,"package.json"),'{"type":"module"}')
    writeFileSync(join(root,"tsconfig.json"),JSON.stringify({
      compilerOptions:{target:"esnext",module:"esnext",moduleResolution:"bundler",strict:true,types:[],rootDir:".",outDir:"out",rewriteRelativeImportExtensions:input.ts},
      vibe:{effectGlobals:false,effectModules:false},files:["main.vibe"]
    }))
    writeFileSync(join(root,"main.vibe"),source)
    if (input.collision) writeFileSync(join(root,input.name.toUpperCase()+".ts"),"export {}\n")
    run(binary,["-p","tsconfig.json","--pretty","false"],root)
    const observe=()=>run(process.execPath,["--input-type=module","-e",'import {read} from "./out/main.js"; console.log(JSON.stringify(read()))'],root)
    const before=observe()
    client=connection(root)
    await client.request("initialize",{processId:process.pid,rootUri:pathToFileURL(root).href,capabilities:{
      workspace:{workspaceEdit:{documentChanges:true,resourceOperations:["create"]}}
    }})
    client.notify("initialized",{})
    const uri=pathToFileURL(join(root,"main.vibe")).href
    client.notify("textDocument/didOpen",{textDocument:{uri,languageId:"vibe",version:1,text:source}})
    const request=only=>client.request("textDocument/codeAction",{
      textDocument:{uri},range:{start:{line:1,character:7},end:{line:1,character:7}},
      context:{diagnostics:[],only}
    })
    const title="Move module to a .ts file"
    const actions=await request(["refactor"])
    const matches=(actions||[]).filter(action=>action.title===title)
    assert.equal(matches.length,1,"expected one module refactor")
    const action=matches[0]
    assert.equal(action.kind,"refactor.rewrite")
    for (const kind of ["quickfix","source.fixAll"]) {
      assert.ok(!(await request([kind])||[]).some(action=>action.title===title),"move must be an explicit refactor")
    }
    const changes=action.edit?.documentChanges
    assert.ok(changes?.some(change=>change.kind==="create"),"atomic CreateFile operation required")
    for (const change of changes) {
      if (change.kind==="create") {
        const path=fileURLToPath(change.uri)
        assert.ok(!existsSync(path),"target already exists")
        writeFileSync(path,"",{flag:"wx"})
      } else {
        const path=fileURLToPath(change.textDocument.uri)
        writeFileSync(path,apply(readFileSync(path,"utf8"),change.edits))
      }
    }
    const target=(input.collision ? "main." : "")+input.name
    const rewritten=readFileSync(join(root,"main.vibe"),"utf8")
    assert.ok(rewritten.includes(JSON.stringify("./"+target+extension)))
    assert.ok(!rewritten.includes("module "+input.name))
    assert.ok(readFileSync(join(root,target+".ts"),"utf8").includes("    second\n  `"))
    run(binary,["-p","tsconfig.json","--pretty","false"],root)
    assert.equal(observe(),before,"copy to a sibling TypeScript file must preserve live exports and template whitespace")
    // The ordinary CLI fix path must leave a legal inline module in place.
    writeFileSync(join(root,"main.vibe"),source)
    run(binary,["-p","tsconfig.json","--fix","--noEmit","--pretty","false"],root)
    assert.ok(readFileSync(join(root,"main.vibe"),"utf8").includes("module "+input.name))
  } finally {client?.kill();rmSync(root,{recursive:true,force:true})}
}

test("move module refactor preserves the program across names, collisions and import styles", {timeout:600000}, async()=>{
  await checkProperty(fc,{
    name:"module-move-copy",rule:"VIP-40: moving a TypeScript module body to a sibling .ts file changes no runtime observation; editor refactor only",
    command:"node --test test/module-refactor.property.test.mjs",
    arbitrary:fc.record({name:fc.constantFrom("parse","ports","parser_2","Parse","Ω"),value:fc.integer({min:-100,max:100}),collision:fc.boolean(),ts:fc.boolean()}),
    regressions:new URL("./property-regressions/",import.meta.url),numRuns:16,check
  })
})

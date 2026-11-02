import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { native, repo, skip, fc } from "./migration-helpers.mjs"
export { skip, fc }

// Chapter 002: "The quick fix wraps a value in a function literal, so the
// handler's kind stays visible in the source, and removes async or * from a
// function". Compare both actual repair paths with an explicit wrapper.
export function project(t, source) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "catch-repair-")))
  t.after(() => rmSync(dir, {recursive:true, force:true}))
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(realpathSync(join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")), join(dir, "node_modules/effect"))
  // Model the published package, as the acceptance harness does. Linking the
  // workspace runtime also exposes its devDependencies as a second Effect
  // instance when an offload runner dereferences package links.
  const runtime=join(dir,"node_modules/vibelang-runtime")
  mkdirSync(runtime)
  cpSync(join(repo,"packages/runtime/package.json"),join(runtime,"package.json"))
  cpSync(join(repo,"packages/runtime/dist"),join(runtime,"dist"),{recursive:true})

  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({compilerOptions:{target:"esnext",module:"nodenext",moduleResolution:"nodenext",strict:true,skipLibCheck:true,types:[],outDir:"out"},include:["*.vibe"]}))
  writeFileSync(join(dir, "main.vibe"), source)
  return dir
}
function compile(dir, ...args) {
  return spawnSync(native, ["-p", ".", "--pretty", "false", ...args], {cwd:dir, encoding:"utf8",timeout:30000})
}
async function editor(dir, source) {
  const child = spawn(native, ["--lsp", "--stdio"], {cwd:dir,stdio:["pipe","pipe","pipe"]})
  let buffer=Buffer.alloc(0), id=0
  const pending=new Map(), transcript=[], stderr=[]
  child.stderr.on("data", d=>stderr.push(d.toString()))
  const send = value => {
    transcript.push({send:value})
    const body=Buffer.from(JSON.stringify({jsonrpc:"2.0",...value}))
    child.stdin.write(Buffer.concat([Buffer.from("Content-Length: "+body.length+"\r\n\r\n"),body]))
  }
  child.stdout.on("data", data=>{
    buffer=Buffer.concat([buffer,data])
    while(true) {
      const end=buffer.indexOf("\r\n\r\n")
      if(end<0) return
      const size=Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0,end).toString())[1])
      if(buffer.length<end+4+size) return
      const value=JSON.parse(buffer.subarray(end+4,end+4+size))
      buffer=buffer.subarray(end+4+size)
      transcript.push({receive:value})
      if(value.method && value.id!==undefined) send({id:value.id,result:value.method==="workspace/configuration"?value.params.items.map(()=>({})):null})
      else pending.get(value.id)?.(value)
    }
  })
  const request = (method,params)=>new Promise((resolve,reject)=>{
    const key=++id
    const timer=setTimeout(()=>{pending.delete(key);reject(new Error("LSP timeout "+method+": "+stderr.join("")))},30000)
    pending.set(key,value=>{clearTimeout(timer);pending.delete(key);value.error?reject(new Error(JSON.stringify(value.error))):resolve(value.result)})
    send({id:key,method,params})
  })
  const uri=pathToFileURL(join(dir,"main.vibe")).href
  try {
    await request("initialize",{processId:process.pid,rootUri:pathToFileURL(dir).href,capabilities:{textDocument:{diagnostic:{}}},initializationOptions:{disableAutomaticTypingAcquisition:true}})
    send({method:"initialized",params:{}})
    send({method:"textDocument/didOpen",params:{textDocument:{uri,languageId:"vibelang",version:1,text:source}}})
    const report=await request("textDocument/diagnostic",{textDocument:{uri}})
    const diagnostic=report.items.find(d=>d.source==="EK" && Number(d.code)===509)
    assert.ok(diagnostic,JSON.stringify(report))
    const actions=await request("textDocument/codeAction",{textDocument:{uri},range:diagnostic.range,context:{diagnostics:[diagnostic],only:["quickfix"]}})
    const chosen=actions?.find(a=>a.title.startsWith("Write the handler as "))
    if(!chosen) return null
    const starts=[0]
    for(let i=0;i<source.length;i++) {
      const ch=source.charCodeAt(i)
      if(ch===13) { if(source.charCodeAt(i+1)===10) i++; starts.push(i+1) }
      else if(ch===10 || ch===0x2028 || ch===0x2029) starts.push(i+1)
    }
    const offset=p=>starts[p.line]+p.character
    const edits=chosen.edit.changes[uri].map(e=>({start:offset(e.range.start),end:offset(e.range.end),text:e.newText})).sort((a,b)=>b.start-a.start)
    for(const e of edits) source=source.slice(0,e.start)+e.text+source.slice(e.end)
    return source
  } finally {
    writeFileSync(join(dir,"lsp-transcript.json"),JSON.stringify({transcript,stderr},null,2))
    child.kill()
  }
}
function exit(dir) {
  const r=spawnSync(process.execPath,["--input-type=module","-e",'import * as Effect from "effect/Effect"; const {main}=await import("./out/main.js"); console.log(JSON.stringify(await Effect.runPromiseExit(main())))'],{cwd:dir,encoding:"utf8",timeout:30000})
  assert.equal(r.status,0,r.stdout+r.stderr)
  return JSON.parse(r.stdout)
}
export async function checkRepair(t, source, manual, {refuse=false,sole=false}={}) {
  const chapter=readFileSync(join(repo,"docs/design/src/002-running.md"),"utf8")
  assert.ok(chapter.includes("The quick fix wraps a value in a function literal, so the handler's kind stays visible in the source"))

  const cli=project(t,source), lsp=project(t,source), control=project(t,manual)
  const original=compile(cli)
  assert.notEqual(original.status,0)
  assert.match(original.stdout,/EK0509/)
  const codes=[...new Set([...original.stdout.matchAll(/\berror ([A-Z]+\d+):/g)].map(m=>m[1]))]
  if(sole) assert.deepEqual(codes,["EK0509"],"fixture has unrelated errors: "+original.stdout)

  const repaired=compile(cli,"--fix")
  const cliText=readFileSync(join(cli,"main.vibe"),"utf8")
  const editorText=await editor(lsp,source)
  if(refuse) {
    assert.equal(cliText,source,"CLI should withhold unsafe repair")
    assert.equal(editorText,null,"editor should withhold unsafe repair")
    assert.match(original.stdout,/explicit.*conversion/i)
    const r=compile(control)
    assert.equal(r.status,0,r.stdout+r.stderr)
    assert.deepEqual(exit(control),{_id:"Exit",_tag:"Success",value:7})
    return
  }
  assert.equal(repaired.status,0,repaired.stdout+repaired.stderr)
  assert.ok(editorText,"missing editor repair")
  writeFileSync(join(lsp,"main.vibe"),editorText)
  for(const dir of [lsp,control]) {
    const r=compile(dir)
    assert.equal(r.status,0,r.stdout+r.stderr)
  }
  const comments=text=>text.match(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g)||[]
  assert.deepEqual(comments(cliText),comments(source),"CLI lost comments")
  assert.deepEqual(comments(editorText),comments(source),"editor lost comments")
  const expected=exit(control)
  assert.deepEqual(exit(cli),expected,"CLI changed Exit")
  assert.deepEqual(exit(lsp),expected,"editor changed Exit")
  const withoutPreludeImport=text=>text.replace('import * as Effect from "effect/Effect"\n', "")
  assert.deepEqual(withoutPreludeImport(cliText),withoutPreludeImport(editorText),"handler repair paths disagree")
  return cliText
}
export function callableSource(handler, declarations='const e="E", error="R", failure="F", $e="outer"') {
  return declarations+'\n/** @throws {never} */\nfunction make(a:string,b:string,c:string,d:string): (caught:string)=>string { return () => [a,b,c,d].join("/") }\nexport effect function main() { return Effect.fail("bad") catch '+handler+' }\n'
}

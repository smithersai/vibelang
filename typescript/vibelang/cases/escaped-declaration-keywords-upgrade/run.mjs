// run-seconds: 120
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath,pathToFileURL} from "node:url"
import {spawnSync} from "node:child_process"
import {Effect} from "effect"
import {main} from "./out/main.js"

const root=path.dirname(fileURLToPath(import.meta.url))
const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const project=path.join(root,"out/upgrade")
fs.mkdirSync(project,{recursive:true})
const source=path.join(project,"main.vibe")
const legacy=fs.readFileSync(path.join(root,"main.before.vibe.txt"),"utf8")
fs.writeFileSync(source,legacy)
fs.writeFileSync(path.join(project,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",strict:true,skipLibCheck:true,types:[],outDir:"built"},files:["main.vibe"]}))
const run=(...args)=>{
 const r=spawnSync(compiler,["-p",project,"--pretty","false",...args],{encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024})
 assert.ifError(r.error)
 return {status:r.status,text:r.stdout+r.stderr}
}
const before=run("--noEmit")
assert.notEqual(before.status,0)
assert.match(before.text,/TS1260/)
const repaired=run("--fix")
assert.equal(repaired.status,0,repaired.text)
const fixed=fs.readFileSync(source,"utf8")
assert.equal(fixed,fs.readFileSync(path.join(root,"main.vibe"),"utf8"))
assert.match(fixed,/error \\u004eamed/)
assert.match(fixed,/er\\u0072or as number/)
const again=run("--fix")
assert.equal(again.status,0,again.text)
assert.equal(fs.readFileSync(source,"utf8"),fixed)
const built=run()
assert.equal(built.status,0,built.text)
const upgraded=await import(pathToFileURL(path.join(project,"built/main.js")))
const expected=["Plain",2,3,"Ready","Named",4]
assert.deepEqual(await Effect.runPromise(main()),expected)
assert.deepEqual(await Effect.runPromise(upgraded.main()),expected)
console.log("ok")

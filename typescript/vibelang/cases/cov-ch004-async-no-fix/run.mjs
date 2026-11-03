import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
const dir=path.join(process.cwd(),"out/repair")
fs.mkdirSync(dir,{recursive:true})
const original=fs.readFileSync("fixture.vibe.txt","utf8")
fs.writeFileSync(path.join(dir,"main.vibe"),original)
fs.writeFileSync(path.join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",strict:true,skipLibCheck:true,noEmit:true,types:[]},include:["main.vibe"]}))
const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const result=spawnSync(compiler,["--fix","-p",dir,"--pretty","false"],{encoding:"utf8",timeout:30000})
assert.ifError(result.error)
const output=result.stdout+result.stderr
const fixed=fs.readFileSync(path.join(dir,"main.vibe"),"utf8")
assert.match(output,/EK0706/)
assert.equal(fixed,original)
console.log("quick fix agrees")

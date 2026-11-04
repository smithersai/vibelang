// run-seconds: 180
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import os from "node:os"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "service-class-fix-"))
fs.mkdirSync(scratch, { recursive: true })
const compiler = process.env.VIBELANG_TEST_COMPILER ?? path.join(here, "../../../built/local/tsc")
const config = {compilerOptions:{target:"ES2022",module:"NodeNext",strict:true,skipLibCheck:true,declaration:true,outDir:"out",rootDir:"."},files:["main.vibe"]}
const run = (exe,args,cwd) => {
 const r=spawnSync(exe,args,{cwd,encoding:"utf8",timeout:30000})
 assert.equal(r.status,0,`${r.error ?? ""}\n${r.stdout}\n${r.stderr}`)
 return r.stdout.trim()
}
try {
for (const [name,separator] of [["space"," "],["comment"," /*identity*/ "],["two-comments","\t/*first*/ /*second*/\t"],["unicode","\u00a0/*unicode*/\u00a0"]]) {
 const dir=path.join(scratch,name);fs.mkdirSync(dir,{recursive:true})
 try {fs.symlinkSync(path.join(here, "node_modules"),path.join(dir,"node_modules"),"dir")}catch{}
 fs.writeFileSync(path.join(dir,"package.json"),'{"type":"module"}')
 fs.writeFileSync(path.join(dir,"tsconfig.json"),JSON.stringify(config))
 const source=`export service${separator}class Users { static readonly key = "test/Users"; value: number }
export const Live = Layer.succeed(Users, {value:7})
export effect function main() {
 let value=0
 provide Live { value=(try Users).value; }
 return {value,key:Users.key}
}
`
 fs.writeFileSync(path.join(dir,"main.vibe"),source)
 run(compiler,["-p",".","--pretty","false"],dir)
 const beforeDts=fs.readFileSync(path.join(dir,"out/main.d.ts"),"utf8")
 const exit=()=>run(process.execPath,["--input-type=module","-e",'import {Effect} from "effect";import {main} from "./out/main.js"; console.log(JSON.stringify(Effect.runSyncExit(main())))'],dir)
 const beforeExit=exit()
 run(compiler,["-p",".","--fix","--pretty","false"],dir)
 const fixed=fs.readFileSync(path.join(dir,"main.vibe"),"utf8")
 assert.ok(!fixed.includes("class Users"),"service class survived "+name)
 for(const comment of separator.match(/\/\*[^]*?\*\//g) ?? [])assert.ok(fixed.includes(comment),"comment lost")
 assert.equal(fs.readFileSync(path.join(dir,"out/main.d.ts"),"utf8"),beforeDts,"API changed")
 assert.equal(exit(),beforeExit,"Exit/key changed")
 console.log(name,"API_EQUAL true EXIT_EQUAL true")
}

} finally { fs.rmSync(scratch, { recursive: true, force: true }) }

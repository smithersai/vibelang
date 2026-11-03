import assert from "node:assert/strict"
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
import {spawnSync} from "node:child_process"
const here=fileURLToPath(new URL(".",import.meta.url))
const scratch=mkdtempSync(join(here,"probe-"))
try {
 writeFileSync(join(scratch,"main.vibe"),readFileSync(new URL("inline.txt",import.meta.url),"utf8"))
 writeFileSync(join(scratch,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",strict:true,types:[],skipLibCheck:true,noEmit:true},files:["main.vibe"]}))
 const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
 const result=spawnSync(compiler,["-p",join(scratch,"tsconfig.json")],{encoding:"utf8",timeout:60000})
 assert.notEqual(result.status,null,result.stderr)
 assert.notEqual(result.status,0,"VIP-25 denies an inline module escape")
 assert.match(result.stdout+result.stderr,/error (?:TS|EK)[0-9]+:/)
 console.log("denied")
}finally {rmSync(scratch,{recursive:true,force:true})}

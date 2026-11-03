import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {readFileSync,writeFileSync,rmSync} from "node:fs"
const file="format-input.vibe"
writeFileSync(file,readFileSync("main.vibe","utf8"))
try{
 const command=new URL("../../../../packages/compiler/bin/vibelang",import.meta.url).pathname
 const r=spawnSync(process.execPath,[command,"format","--write",file],{encoding:"utf8",timeout:60000})
 assert.equal(r.status,0,r.stderr+r.stdout)
 assert.match(readFileSync(file,"utf8"),/provide Layer\.empty,(?:[^\r\n]*Layer\.empty){5}[^\r\n]*\{/)
 console.log("provider list stayed on one line")
}finally{rmSync(file,{force:true})}

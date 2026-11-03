import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {readFileSync,writeFileSync,mkdirSync,rmSync} from "node:fs"
import {fileURLToPath} from "node:url"
const work=new URL("out/migration/",import.meta.url)
mkdirSync(work,{recursive:true})
writeFileSync(new URL("package.json",work),'{"type":"module"}')
writeFileSync(new URL("tsconfig.json",work),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",strict:true,types:[],skipLibCheck:true,noEmit:true},files:["main.vibe"]}))
const source="export effect function start(){return fork(Effect.succeed(1),{startImmediately:true,uninterruptible:\"inherit\"})}\n"
writeFileSync(new URL("main.vibe",work),source)
const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const fixed=spawnSync(compiler,["-p",fileURLToPath(new URL("tsconfig.json",work)),"--fix","--noEmit"],{encoding:"utf8",timeout:30000})
const text=readFileSync(new URL("main.vibe",work),"utf8")
assert.match(text,/try Effect\.forkChild\s*\(/,"VIP-6 codemod must preserve the legacy fork options through the native API; "+fixed.stdout+fixed.stderr)
assert.match(text,/startImmediately\s*:\s*true/)
assert.match(text,/uninterruptible\s*:\s*"inherit"/)
assert.equal(fixed.status,0,fixed.stdout+fixed.stderr)
console.log("legacy fork options preserved")

import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const here=dirname(fileURLToPath(import.meta.url))
const binary=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const dir=mkdtempSync(join(tmpdir(),"explicit-sidecar-"))
try {
 symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
 writeFileSync(join(dir,"package.json"),'{"type":"module"}')
 writeFileSync(join(dir,"main.vibe"),"export const answer=1")
 const original="export declare const answer: string; // preserve\\n"
 writeFileSync(join(dir,"main.d.vibe.ts"),original)
 writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",moduleResolution:"nodenext",strict:true,types:[],skipLibCheck:true,outDir:"out"},files:["main.vibe","main.d.vibe.ts"]}))
 const r=spawnSync(binary,["-p",dir,"--pretty","false"],{encoding:"utf8",timeout:60000})
 assert.equal(r.status,1,r.stdout+r.stderr)
 assert.match(r.stdout+r.stderr,/TS5055/)
 assert.equal(readFileSync(join(dir,"main.d.vibe.ts"),"utf8"),original)
 console.log("protected")
}finally{rmSync(dir,{recursive:true,force:true})}

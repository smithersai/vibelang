// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"

const p=project(import.meta.url,"bun-check",{"answer.vibe":"export effect function answer() { return 7 }"}, {compilerOptions:{noEmit:false,declaration:true}})
const emitted=check(p)
assert.equal(emitted.status,0,emitted.output)
assert.ok(fs.existsSync(path.join(p.dir,"answer.d.vibe.ts")),"the checker needs the source sidecar")
p.write("consumer.ts",'import { answer } from "./answer.vibe"\nimport type { Effect } from "effect"\nconst checked:Effect.Effect<number>=answer()\n')
p.write("tsconfig.check.json",JSON.stringify({compilerOptions:{strict:true,target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",skipLibCheck:true,types:[],allowArbitraryExtensions:true,noEmit:true},files:["consumer.ts"]}))
p.write("package.json",JSON.stringify({name:"@coverage/bun-check",type:"module",scripts:{check:"node check.mjs"}}))
p.write("check.mjs",'import fs from "node:fs";import {spawnSync} from "node:child_process";fs.writeFileSync("called-check.txt","stock");const r=spawnSync(process.execPath,[process.env.COVERAGE_STOCK_TSC,"-p","tsconfig.check.json"],{stdio:"inherit"});process.exit(r.status??1)')
let result=run("bun",["check"],p.dir,{env:{...process.env,COVERAGE_STOCK_TSC:stock}})
assert.equal(result.status,0,result.output)
assert.equal(p.read("called-check.txt"),"stock")
fs.unlinkSync(path.join(p.dir,"called-check.txt"))
p.write("consumer.ts",'const rejected:string=123\n')
result=run("bun",["check"],p.dir,{env:{...process.env,COVERAGE_STOCK_TSC:stock}})
assert.notEqual(result.status,0,"bun check did not run the configured checker")
assert.equal(p.read("called-check.txt"),"stock")

// Spec rule: docs/design/src/001-functions.md#70decd41300d6864
// Chapter 001: check-script.
console.log("coverage-ok")

// run-seconds: 365
import { assertProgramTypes } from "../../test/assert-coverage-twin.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { main } from "./out/main.js"

const require = createRequire(import.meta.url)
const tsc = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
const result = spawnSync(process.execPath, [tsc, "-p", "reference"], { encoding: "utf8", timeout: 60000 })
assert.equal(result.status, 0, result.stdout + result.stderr)
assertProgramTypes(import.meta.url, tsc, "reference")
const reference = await import("./reference/out/main.js")
assert.deepEqual(Effect.runSyncExit(main()), Effect.runSyncExit(reference.main()))


// VIP-3 legacy alias migration: warning, scope-sensitive repair and idempotence.
const {mkdtempSync,writeFileSync,readFileSync,symlinkSync,rmSync}=await import("node:fs")
const {fileURLToPath}=await import("node:url")
const {join}=await import("node:path")
const here=fileURLToPath(new URL(".",import.meta.url))
const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const dir=mkdtempSync(join(here,".companion-"))
try {
 symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
 writeFileSync(join(dir,"package.json"),'{"type":"module"}')
 writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:true,types:[],declaration:true,outDir:"out"},include:["*.vibe","native.ts"]}))
 const source="export let v: Effect<number>;\nexport let e: Effect<string,Error>;\nexport let n: Effect<string,never>;\nexport let u: Effect<number|string>;\nexport let a: Effect<number,Error>[];\nexport let m: Effect<number>|undefined;\nexport interface I extends Effect<number> {}\n"
 const local="type Effect<A>={value:A}; export let local:Effect<number>;\n"
 const imported='import type {Effect} from "./native.js"; export let imported:Effect<number>;\n'
 writeFileSync(join(dir,"main.vibe"),source);writeFileSync(join(dir,"local.vibe"),local);writeFileSync(join(dir,"imported.vibe"),imported);writeFileSync(join(dir,"native.ts"),"export type Effect<A>={value:A}\n")
 const cli=(args)=>{const r=spawnSync(compiler,["-p",dir,...args,"--pretty","false"],{encoding:"utf8",timeout:60000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout+r.stderr}
 const warnings=cli(["--noEmit"])
 assert.equal((warnings.match(/EK4856/g)||[]).length,7,"every resolved legacy alias gets a transition warning")
 cli(["--fix"])
 assert.equal(readFileSync(join(dir,"local.vibe"),"utf8"),local,"local type keeps ordinary meaning")
 assert.equal(readFileSync(join(dir,"imported.vibe"),"utf8"),imported,"imported type keeps ordinary meaning")
 const fixed=readFileSync(join(dir,"main.vibe"),"utf8");const compact=fixed.replace(/\s/g,"")
 for(const expected of ["v:number!!","e:string!Error","n:string!never","u:Effect.Effect<number|string>","a:Effect.Effect<number,Error>[]","m:Effect.Effect<number>|undefined","IextendsEffect.Effect<number>"])assert.ok(compact.includes(expected),expected+"\n"+fixed)
 assert.ok(!cli(["--noEmit"]).includes("EK4856"),"repair retires all warnings")
 cli(["--fix"])
 assert.equal(readFileSync(join(dir,"main.vibe"),"utf8"),fixed,"second --fix is byte-idempotent")
 console.log("types and Exit agree")
}finally{rmSync(dir,{recursive:true,force:true})}

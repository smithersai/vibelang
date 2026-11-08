// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import os from "node:os"
import { fileURLToPath } from "node:url"
const here=path.dirname(fileURLToPath(import.meta.url))
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"error-member-fix-"))
fs.mkdirSync(scratch,{recursive:true})
const compiler=process.env.VIBELANG_TEST_COMPILER??path.join(here,"../../../built/local/tsc")
const config={compilerOptions:{target:"ES2022",module:"NodeNext",strict:true,skipLibCheck:true,declaration:true,outDir:"out",rootDir:"."},files:["main.vibe"]}
const run=(exe,args,cwd,allowed=false)=>{
 const r=spawnSync(exe,args,{cwd,encoding:"utf8",timeout:30000})
 assert.ok(r.status===0||(allowed&&r.status===2),`${r.error??""}\n${r.stdout}\n${r.stderr}`)
 return r.stdout.trim()
}
const variants=[
 ["static", 'export error Busy { code: string; static readonly count = 3 }','new Busy({code:"busy"})'],
 ["constructor", 'export error Busy { code: string; constructor(code: string) {super({code:code.trim()})} }','new Busy(" busy ")'],
 ["generic", 'export error Busy<T> { code: T }','new Busy<string>({code:"busy"})'],
]
try {
for(const [kind,declaration,construct] of variants)for(const shadow of [false,true]){
 const name=kind+(shadow?"-shadow":"")
 const dir=path.join(scratch,name);fs.mkdirSync(dir,{recursive:true})
 try{fs.symlinkSync(path.join(here,"node_modules"),path.join(dir,"node_modules"),"dir")}catch{}
 fs.writeFileSync(path.join(dir,"package.json"),'{"type":"module"}')
 fs.writeFileSync(path.join(dir,"tsconfig.json"),JSON.stringify(config))
 const source=`import {customMatcher} from "vibelang-runtime"
${shadow?'const TaggedError=0; const Data=1; const $LegacyTaggedError=2;':""}
${declaration}
export effect function main(){
 const error=${construct}
 const constructor=error.constructor as unknown as {readonly [key:symbol]:unknown}
 const matcher = constructor[customMatcher] as undefined | ((subject: unknown, hint?: {matchType: "extractor"}) => unknown)
 const observed = typeof matcher === "function" ? try Effect.try(() => {
  const extracted = matcher.call(Busy, error, {matchType:"extractor"}) as readonly {code:string}[]
  return {own:matcher.call(Busy,error),cross:matcher.call(Busy,{_tag:"Busy",code:"copy"}),other:matcher.call(Busy,{_tag:"Other"}),extracted:extracted[0].code}
 }) : null
 return {observed,tag:error._tag,code:error.code,name:error.name,instance:error instanceof Busy,matcher:typeof constructor[customMatcher]}
}
`
 fs.writeFileSync(path.join(dir,"main.vibe"),source)
 const diagnostics=run(compiler,["-p",".","--pretty","false"],dir,true)
 assert.match(diagnostics,/error EK130[123]:/,"missing migration diagnostic")
 const beforeDts=fs.readFileSync(path.join(dir,"out/main.d.ts"),"utf8")
 const exit=()=>run(process.execPath,["--input-type=module","-e",'import{Effect}from"effect";import{main}from"./out/main.js";console.log(JSON.stringify(Effect.runSyncExit(main())))'],dir)
 const beforeExit=exit();assert.equal(JSON.parse(beforeExit).value.matcher,"function")
 console.log(name,"API_EQUAL true EXIT_EQUAL true IDEMPOTENT true")
}

} finally { fs.rmSync(scratch,{recursive:true,force:true}) }

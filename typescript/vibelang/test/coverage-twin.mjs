// Stock TypeScript 5.9.3 checks both APIs; historical oracle uses Effect 4.1.0.
// Normal smoke runs use the checkout pin. Missing dependencies fail, never skip.
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {readFileSync,existsSync,writeFileSync,mkdirSync,symlinkSync,rmSync,cpSync} from "node:fs"
import path from "node:path"
export function checkTwin(dir){
 const modules=process.env.COV_MODULES_REFERENCE_NODE_MODULES??process.env.EFFECT_NODE_MODULES
 assert.ok(modules,"set EFFECT_NODE_MODULES; COV_MODULES_REFERENCE_NODE_MODULES selects the historical 4.1.0 oracle")
 const pin=process.env.COV_MODULES_REFERENCE_NODE_MODULES?"4.1.0":JSON.parse(readFileSync(new URL("../../../packages/runtime/package.json",import.meta.url))).peerDependencies.effect
 for(const [name,version]of [["typescript","5.9.3"],["effect",pin]])
  assert.equal(JSON.parse(readFileSync(path.join(modules,name,"package.json"))).version,version)
 const work=path.join(dir,".cache/coverage-twin")
 rmSync(work,{recursive:true,force:true});mkdirSync(path.join(work,"node_modules"),{recursive:true})
 symlinkSync(path.join(modules,"effect"),path.join(work,"node_modules/effect"))
 writeFileSync(path.join(work,"package.json"),'{"type":"module"}')
 cpSync(path.join(dir,"effect"),path.join(work,"reference"),{recursive:true})
 cpSync(path.join(dir,"out"),path.join(work,"vibe"),{recursive:true})
 writeFileSync(path.join(work,"types.ts"),[
  'import {Effect} from "effect"',
  'import * as V from "./vibe/main.js"',
  'import * as R from "./reference/main.js"',
  'type Exact<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false',
  'const success:Exact<Effect.Success<ReturnType<typeof V.main>>,Effect.Success<ReturnType<typeof R.main>>>=true',
  'const error:Exact<Effect.Error<ReturnType<typeof V.main>>,Effect.Error<ReturnType<typeof R.main>>>=true',
  'const services:Exact<Effect.Services<ReturnType<typeof V.main>>,Effect.Services<ReturnType<typeof R.main>>>=true',
  existsSync(path.join(dir,"type-assertions.ts"))?readFileSync(path.join(dir,"type-assertions.ts"),"utf8"):""
 ].join("\n"))
 writeFileSync(path.join(work,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,skipLibCheck:true,types:[],outDir:"checked",declaration:true},include:["reference/*.ts","types.ts"]}))
 const compiled=spawnSync(process.execPath,[path.join(modules,"typescript/bin/tsc"),"-p",path.join(work,"tsconfig.json")],{encoding:"utf8",timeout:60000})
 assert.equal(compiled.status,0,"twin types:\n"+compiled.stdout+compiled.stderr)
 const runner=entry=>'import {Effect} from "effect";import {main} from '+JSON.stringify(entry)+';const ex=await Effect.runPromiseExit(main());console.log("@@exit"+JSON.stringify(ex))'
 const native=path.join(work,"native.mjs"),vibe=path.join(dir,"out/coverage-exit.mjs")
 writeFileSync(native,runner("./checked/reference/main.js"));writeFileSync(vibe,runner("./main.js"))
 const execute=file=>{
  const r=spawnSync(process.execPath,[file],{encoding:"utf8",timeout:60000})
  assert.equal(r.status,0,r.stdout+r.stderr)
  const line=r.stdout.split("\n").find(x=>x.startsWith("@@exit"))
  assert.ok(line,"missing Exit receipt: "+r.stdout)
  return JSON.parse(line.slice(6))
 }
 assert.deepEqual(execute(vibe),execute(native),"VibeLang / Effect TypeScript Exit mismatch")
}

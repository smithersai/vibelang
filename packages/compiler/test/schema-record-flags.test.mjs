import {strict as assert} from "node:assert"
import {spawnSync} from "node:child_process"
import {existsSync,mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {test} from "node:test"
import {fileURLToPath,pathToFileURL} from "node:url"

const repo=fileURLToPath(new URL("../../../",import.meta.url))
const native=process.env.VIBELANG_BINARY || join(repo,"typescript/built/local/tsc")
const effect=join(process.env.EFFECT_NODE_MODULES || join(repo,"experiments/node_modules"),"effect")
const runtime=join(repo,"packages/runtime")
const missing=[native,effect,join(runtime,"dist/index.js")].find(path=>!existsSync(path))
const skip=missing!==undefined && "build the native compiler and runtime first: "+missing

test("schema record flag migration preserves subclass evaluation order",{skip},t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"vibelang-schema-flags-")))
 t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,"node_modules"))
 symlinkSync(realpathSync(effect),join(root,"node_modules/effect"))
 symlinkSync(runtime,join(root,"node_modules/vibelang-runtime"))
 writeFileSync(join(root,"package.json"),'{"type":"module"}')
 writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",strict:true,types:[],skipLibCheck:true,outDir:"out"},include:["*.vibe"]}))
 writeFileSync(join(root,"main.vibe"),"export const events: string[]=[]\nconst Optional=Schema.optionalKey(Schema.Number)\nconst Refs={get Optional(){events.push(\"codec\");return Optional}}\nexport abstract schema error Parent { id: string }\nconst originalExtend=Parent.extend\nObject.defineProperty(Parent,\"extend\",{get: (): infer _ => {events.push(\"extend\");return originalExtend}})\nexport schema error Child extends Parent { value: Readonly<Record<\"a\", Refs.Optional>> }\n")
 const fixed=spawnSync(native,["-p",".","--fix","--fix-migration-only","--pretty","false"],{cwd:root,encoding:"utf8"})
 assert.equal(fixed.status,0,fixed.stdout+fixed.stderr)
 assert.ok(fixed.stdout.includes("EK2109 ×1"),fixed.stdout)
 const script="const m=await import("+JSON.stringify(pathToFileURL(join(root,"out/main.js")).href)+"); console.log(m.events.join(','))"
 const run=spawnSync(process.execPath,["--input-type=module","-e",script],{cwd:root,encoding:"utf8"})
 assert.equal(run.status,0,run.stdout+run.stderr)
 assert.equal(run.stdout,"extend,codec\n")
})

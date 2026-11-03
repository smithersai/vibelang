import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
// Chapter 007 / native namespace and unbound type diagnostics: docs/design/src/007-tooling.md#ceec382b7afa3334
test.todo("Chapter 007 / module-only Effect and unbound Effect follow native type lookup",t=>{
 for(const native of [true,false])for(const modules of [true,false]){
  const root=mkdtempSync(join(tmpdir(),"chapter007-alias-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
  mkdirSync(join(root,"node_modules"));symlinkSync(join(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"),"effect"),join(root,"node_modules/effect"))
  writeFileSync(join(root,"package.json"),'{"type":"module"}');const file=native?"main.ts":"main.vibe";writeFileSync(join(root,file),(native&&modules?'import * as Effect from "effect/Effect";\n':"")+"export type Value=Effect<number>\n")
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],noEmit:true},vibe:{effectGlobals:false,effectModules:modules},files:[file]}))
  const r=spawnSync(native?process.execPath:binary,native?[join(repo,"docs/tools/node_modules/typescript/bin/tsc"),"-p",".","--pretty","false"]:["-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:60000})
  assert.notEqual(r.status,0,(native?"native":"vibe")+" modules="+modules+": "+r.stdout+r.stderr)
  assert.match(r.stdout,new RegExp(modules?"TS2709:":"TS2304:"))
 }
})

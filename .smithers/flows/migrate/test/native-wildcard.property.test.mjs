import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {test} from 'node:test'
import {routeEmittedExports} from '../lib/emitted-exports.mjs'
import {checkProperty} from '../../../../scripts/testing/property.mjs'
const require=createRequire(new URL('../../../../packages/runtime/package.json',import.meta.url))
const ts=require('typescript'),fc=require('fast-check')
const corpus=JSON.parse(readFileSync(new URL('./corpus/opencode-native-wildcard-js-edge.json',import.meta.url)))
const rule='Existing tools work.'
function scenario({entry=corpus.entry,field='exports',form='self',condition=false}={}) {
 const root=mkdtempSync(join(tmpdir(),'native-wildcard-'))
 const put=(f,s)=>{mkdirSync(dirname(join(root,f)),{recursive:true});writeFileSync(join(root,f),s)}
 try {
  const key=field==='exports'?'./*':'#*',manifest={name:'native-wildcard-fixture',type:'module',[field]:{[key]:condition?{development:'./src/*.ts',default:'./src/*.ts'}:'./src/*.ts'}}
  manifest.exports??={}
  manifest.exports['./leaf']={types:'./src/leaf.d.vibe.ts','vibelang-source':'./src/leaf.vibe',default:'./.vibelang/js/src/leaf.js'}
  put('package.json',JSON.stringify(manifest))
  put('src/leaf.vibe','export const leaf = 1\n')
  put('.vibelang/js/src/leaf.js','export const leaf = 1\n')
  const outputs={'./src/leaf.vibe':'./.vibelang/js/src/leaf.js'}
  const text=form==='self'?corpus.source.replaceAll('session-legacy',entry.split('/').at(-1)):form==='export'?'export {value} from "./internal.js";':'import {value} from "./internal.js"; export {value};'
  for(const [name,body] of [[entry,text],[dirname(entry)==='.'?'internal':dirname(entry)+'/internal','export const value = 42;'],['provided','export const provided = 7;']]) {
   put('src/'+name+'.ts',body)
   put('.vibelang/js/src/'+name+'.js',ts.transpileModule(body,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText)
   outputs['./src/'+name+'.ts']='./.vibelang/js/src/'+name+'.js'
  }
  const spec=field==='exports'?'native-wildcard-fixture/'+entry:'#'+entry
  const runNode=()=>spawnSync(process.execPath,['--input-type=module','-e','const m=await import('+JSON.stringify(spec)+'); if(m.value!==42)throw Error("value");'],{cwd:root,encoding:'utf8',timeout:30000})
  const before=runNode()
  assert.equal(before.status,1,'native source routing exposes a missing .js dependency under Node')
  assert.match(before.stderr,/ERR_MODULE_NOT_FOUND/)
  put('consumer.ts','export {}')
  const resolve=()=>ts.resolveModuleName(spec,join(root,'consumer.ts'),{moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext},ts.sys).resolvedModule?.resolvedFileName
  const nativeType=resolve();assert.equal(nativeType,join(root,'src/'+entry+'.ts'))
  let graph
  routeEmittedExports(root,outputs,{typescript:ts,onGraph:g=>graph=g})
  const after=runNode()
  assert.equal(after.status,0,after.stdout+after.stderr)
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
  assert.deepEqual(pkg[field][key],manifest[field][key],'source fallback remains intact')
  assert.equal(pkg[field][field==='exports'?'./provided':'#provided'],undefined,'unrelated provided facade is not rerouted')
  assert.equal(resolve(),nativeType,'type source resolution is unchanged')
  assert.equal(graph.mode,'component')
  const once=readFileSync(join(root,'package.json'),'utf8')
  assert.equal(routeEmittedExports(root,outputs,{typescript:ts}),false)
  assert.equal(readFileSync(join(root,'package.json'),'utf8'),once)
  routeEmittedExports(root,{}, {restore:true,typescript:ts})
  assert.deepEqual(JSON.parse(readFileSync(join(root,'package.json'),'utf8')),manifest)
 } finally {rmSync(root,{recursive:true,force:true})}
}
test('native wildcard oracle quotes Chapter 7',()=>assert.ok(readFileSync(new URL('../../../../docs/design/src/007-tooling.md',import.meta.url),'utf8').includes(rule)))
test('opencode: native session-legacy wildcard resolves its emitted self-export under Node',()=>scenario())
test('property: public native JS edges route without changing source fallback or types',async()=>checkProperty(fc,{name:'opencode-native-wildcard-js-edge',rule,command:'node --test test/native-wildcard.property.test.mjs',numRuns:80,generatorVersion:1,regressions:new URL('./corpus/',import.meta.url),arbitrary:fc.record({entry:fc.constantFrom('session-legacy','nested/legacy','space name','雪'),field:fc.constantFrom('exports','imports'),form:fc.constantFrom('self','export','import'),condition:fc.boolean()}),check:scenario}))

test('native edges outside the selected runtime export remain source-only',()=>{
 for(const mode of ['type-only','ts-edge','existing-js','shadowed-exact','shadowed-pattern','private']) {
  const root=mkdtempSync(join(tmpdir(),'native-wildcard-boundary-'))
  const put=(f,s)=>{mkdirSync(dirname(join(root,f)),{recursive:true});writeFileSync(join(root,f),s)}
  try {
   const manifest={name:'native-boundary',type:'module',exports:{'./*':'./src/*.ts'}}
   if(mode==='private')manifest.exports={'.':'./src/provided.ts'}
   if(mode==='shadowed-exact')manifest.exports['./legacy']='./src/provided.ts'
   if(mode==='shadowed-pattern'){manifest.exports['./legacy*']='./src/provided.ts'}
   put('package.json',JSON.stringify(manifest))
   const outputs={'./src/leaf.vibe':'./.vibelang/js/src/leaf.js'}
   put('src/leaf.vibe','export const leaf = 1');put('.vibelang/js/src/leaf.js','export const leaf = 1')
   const source=mode==='type-only'?'export type {T} from "./internal.js";':mode==='ts-edge'?'export {value} from "./internal.ts";':'export {value} from "./internal.js";'
   put('src/legacy.ts',source)
   put('src/internal.ts','export type T = number; export const value = 42;')
   put('src/provided.ts','export const provided = 7;')
   if(mode==='existing-js')put('src/internal.js','export const value = 42;')
   for(const name of ['legacy','internal','provided']) {
    put('.vibelang/js/src/'+name+'.js',ts.transpileModule(readFileSync(join(root,'src/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText)
    outputs['./src/'+name+'.ts']='./.vibelang/js/src/'+name+'.js'
   }
   let graph
   routeEmittedExports(root,outputs,{typescript:ts,onGraph:g=>graph=g})
   assert.deepEqual(JSON.parse(readFileSync(join(root,'package.json'),'utf8')),manifest,mode)
   assert.equal(graph.selected,1,mode)
  } finally {rmSync(root,{recursive:true,force:true})}
 }
})

test('public native routes account for indirect dependencies without following private importers',()=>{
 for(const indirect of [true,false]) {
  const root=mkdtempSync(join(tmpdir(),'native-wildcard-indirect-'))
  const put=(f,s)=>{mkdirSync(dirname(join(root,f)),{recursive:true});writeFileSync(join(root,f),s)}
  try {
   const manifest={name:'native-indirect',type:'module',exports:{'.':'./src/public.ts'}}
   put('package.json',JSON.stringify(manifest))
   const files=indirect?{'public.ts':'export {value} from "./bridge.js";','bridge.js':'export {value} from "./internal.js";','internal.ts':'export const value = 42;'}
    :{'public.ts':'export const value = 42;','private.ts':'export {value} from "./public.js"; export * from "./internal.js";','internal.ts':'export const other = 1;'}
   const outputs={'./src/leaf.vibe':'./.vibelang/js/src/leaf.js'}
   put('src/leaf.vibe','export const leaf = 1');put('.vibelang/js/src/leaf.js','export const leaf = 1')
   for(const [file,text] of Object.entries(files)) {
    put('src/'+file,text)
    const out='.vibelang/js/src/'+file.replace(/\.ts$/,'.js')
    put(out,ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText)
    outputs['./src/'+file]='./'+out
   }
   let graph
   routeEmittedExports(root,outputs,{typescript:ts,onGraph:g=>graph=g})
   const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
   if(indirect) {
    assert.equal(pkg.exports['.'].default,'./.vibelang/js/src/public.js')
    const r=spawnSync(process.execPath,['--input-type=module','-e','const m=await import("native-indirect");if(m.value!==42)throw Error("value")'],{cwd:root,encoding:'utf8',timeout:30000})
    assert.equal(r.status,0,r.stderr)
   } else {
    assert.deepEqual(pkg,manifest)
    assert.equal(graph.selected,1)
   }
  } finally {rmSync(root,{recursive:true,force:true})}
 }
})

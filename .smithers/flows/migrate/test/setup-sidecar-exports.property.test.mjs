import assert from 'node:assert/strict'
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'
import {makeConfig,wireTarget} from '../lib/steps.mjs'
import * as C from '../lib/codemod.mjs'
const repo=fileURLToPath(new URL('../../../../',import.meta.url)),require=createRequire(join(repo,'packages/runtime/package.json'))
const ts=require('typescript'),fc=require('fast-check')
const corpus=JSON.parse(readFileSync(new URL('./corpus/opencode-relocated-existing-sidecar-exports.json',import.meta.url)))
const put=(root,file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
const run=(root,exe,args)=>spawnSync(exe,args,{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:8<<20})

test('opencode: full setup resyncs existing sidecar exports before native consumers check',async t=>{
 const root=mkdtempSync(join(tmpdir(),'sidecar-export-upgrade-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 put(root,'package.json',JSON.stringify({name:'sidecar-export-upgrade',private:true,type:'module',workspaces:['packages/*']}))
 put(root,'packages/a/package.json',JSON.stringify(corpus.manifest))
 put(root,'packages/a/tsconfig.json',JSON.stringify({compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'Bundler',strict:true,skipLibCheck:false,types:[]},vibe:{effectGlobals:false,effectModules:false},include:['src']}))
 put(root,'tsconfig.json',JSON.stringify({compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'Bundler',strict:true,skipLibCheck:false,types:[]},include:['consumer.ts']}))
 put(root,'packages/a/src/index.vibe',corpus.source);put(root,'consumer.ts',corpus.consumer);put(root,'scan.ts',corpus.enumerator)
 mkdirSync(join(root,'node_modules/@probe'),{recursive:true})
 symlinkSync(join(root,'packages/a'),join(root,'node_modules/@probe/a'),'dir')
 for(const [name,target] of [['typescript',join(repo,'packages/runtime/node_modules/typescript')],['effect',join(repo,'packages/runtime/node_modules/effect')],['vibelang',join(repo,'packages/compiler')],['vibelang-runtime',join(repo,'packages/runtime')]])symlinkSync(target,join(root,'node_modules',name),'dir')
 const native=process.env.VIBELANG_BINARY??join(repo,'packages/compiler/native/vibelang')
 const compile=()=>{const r=run(root,native,['--noEmit','-p','packages/a/tsconfig.json','--pretty','false']);assert.equal(r.status,0,r.stdout+r.stderr)}
 const consumer=()=>run(root,process.execPath,[require.resolve('typescript/lib/tsc.js'),'--noEmit','-p','tsconfig.json','--pretty','false'])
 const init=run(root,'jj',['git','init','--colocate']);assert.equal(init.status,0,init.stderr)
 for(const [key,value] of [['user.name','test'],['user.email','test@example.invalid']])assert.equal(run(root,'jj',['config','set','--repo',key,value]).status,0)
 compile();const before=consumer();assert.equal(before.status,0,before.stdout+before.stderr)
 assert.ok(existsSync(join(root,'packages/a/src/index.d.vibe.ts')))
 const config=makeConfig({target:root,packages:['packages/a'],test:'true',vibelangVersion:'0.0.11',install:'true'})
 const first=await wireTarget(config,join(root,'.logs'));assert.ok(first.sidecarDir)
 compile();assert.equal(existsSync(join(root,'packages/a/src/index.d.vibe.ts')),false)
 const moved='./.vibe/declarations/src/index.d.vibe.ts';assert.ok(existsSync(join(root,'packages/a',moved)))
 const after=consumer();assert.equal(after.status,0,'the native API consumer must still resolve its declarations: '+after.stdout+after.stderr)
 let pkg=JSON.parse(readFileSync(join(root,'packages/a/package.json'),'utf8'))
 assert.equal(pkg.exports['.'].types,moved)
 assert.equal(pkg.exports['.']['vibelang-source'],corpus.manifest.exports['.']['vibelang-source'])
 assert.equal(pkg.exports['.'].default,corpus.manifest.exports['.'].default)
 // Repair a previous setup's stale metadata even after the old file and the
 // source enumerator are gone; the effective sidecar layout still applies.
 pkg.exports['.'].types=corpus.manifest.exports['.'].types;put(root,'packages/a/package.json',JSON.stringify(pkg));rmSync(join(root,'scan.ts'))
 await wireTarget(config,join(root,'.logs'));const repaired=consumer();assert.equal(repaired.status,0,repaired.stdout+repaired.stderr)
 assert.equal(JSON.parse(readFileSync(join(root,'packages/a/package.json'),'utf8')).exports['.'].types,moved)
})

function layoutCase({nested,stem,output,inherited,configDir,bare,oldExists,pattern}) {
 const root=mkdtempSync(join(tmpdir(),'sidecar-export-property-'))
 try {
  const owner=nested?'packages/a':'.',path=file=>owner==='.'?file:owner+'/'+file
  const old='./'+stem+'.d.vibe.ts',next='./'+output+'/'+stem+'.d.vibe.ts',top=bare?old.slice(2):old,topNext=bare?next.slice(2):next
  const pkg={name:'fixture-a',types:top,typings:old,typesVersions:{'*':{feature:[top,'./native.d.ts']}},exports:{'.':{types:{import:old,default:[old,null]},'vibelang-source':'./'+stem+'.vibe',default:'./dist/index.js'},'./asset':'./asset.json','./authored':{types:'./authored.d.ts',default:'./authored.js'}},imports:{'#leaf':{types:old,default:'./dist/index.js'}},description:old,custom:{types:old}}
  if(pattern)pkg.exports['./*']={types:'./src/*.d.vibe.ts',default:'./dist/*.js'}
  if(nested)put(root,'package.json','{"name":"root","private":true}')
  put(root,path('package.json'),JSON.stringify(pkg))
  const value=configDir?'${configDir}/'+output:inherited?'../'+output:output
  const cfg={compilerOptions:{},include:['src']}
  if(inherited||configDir){cfg.extends='./config/base.json';put(root,path('config/base.json'),JSON.stringify({vibe:{sidecarDir:value}}))}else cfg.vibe={sidecarDir:value}
  put(root,path('tsconfig.json'),JSON.stringify(cfg));put(root,path(stem+'.vibe'),'export const value = 1\n')
  const tracked=[path('package.json'),path('tsconfig.json'),path(stem+'.vibe')]
  if(oldExists){put(root,path(stem+'.d.vibe.ts'),'export declare const value = 1\n');tracked.push(path(stem+'.d.vibe.ts'))}
  const bridge='packages/bridge/package.json',beforeBridge={name:'bridge',types:join('..','..',path(stem+'.d.vibe.ts')).replaceAll('\\','/')}
  // Compute from the bridge directory, independently from the production mapper.
  const rel=require('node:path').posix.relative('packages/bridge',path(stem+'.d.vibe.ts'))
  beforeBridge.types=rel;put(root,bridge,JSON.stringify(beforeBridge));tracked.push(bridge)
  const unrelated='packages/unrelated/package.json',unrelatedText='{"name":"unrelated","types":"./src/native.d.vibe.ts"}'
  put(root,unrelated,unrelatedText);put(root,'packages/unrelated/src/native.vibe','export const native = 1');tracked.push(unrelated,'packages/unrelated/src/native.vibe')
  mkdirSync(join(root,'node_modules'),{recursive:true});symlinkSync(join(repo,'packages/runtime/node_modules/typescript'),join(root,'node_modules/typescript'),'dir')
  const warnings=[],edits=C.refreshSidecarExports(root,tracked,new Set([path('tsconfig.json')]),{onWarning:w=>warnings.push(w)})
  assert.deepEqual(warnings,[])
  const after=JSON.parse(readFileSync(join(root,path('package.json')),'utf8'))
  assert.equal(after.types,topNext);assert.equal(after.typings,next)
  assert.deepEqual(after.typesVersions['*'].feature,[topNext,'./native.d.ts'])
  assert.deepEqual(after.exports['.'].types,{import:next,default:[next,null]})
  assert.equal(after.exports['.']['vibelang-source'],pkg.exports['.']['vibelang-source']);assert.equal(after.exports['.'].default,pkg.exports['.'].default)
  assert.deepEqual(after.exports['./asset'],pkg.exports['./asset']);assert.deepEqual(after.exports['./authored'],pkg.exports['./authored'])
  assert.deepEqual(after.imports['#leaf'],{types:next,default:'./dist/index.js'})
  assert.equal(after.description,old);assert.deepEqual(after.custom,{types:old})
  if(pattern)assert.deepEqual(after.exports['./*'],{types:'./'+output+'/src/*.d.vibe.ts',default:'./dist/*.js'})
  assert.equal(JSON.parse(readFileSync(join(root,bridge),'utf8')).types,require('node:path').posix.relative('packages/bridge',path(output+'/'+stem+'.d.vibe.ts')))
  assert.equal(readFileSync(join(root,unrelated),'utf8'),unrelatedText)
  assert.equal(existsSync(join(root,path(stem+'.d.vibe.ts'))),oldExists,'metadata refresh itself does not delete output')
  assert.ok(edits.some(e=>e.manifest===bridge));assert.deepEqual(C.refreshSidecarExports(root,tracked,new Set([path('tsconfig.json')])),[])
 } finally {rmSync(root,{recursive:true,force:true})}
}
test('property: existing declaration targets follow the effective layout without changing runtime or authored metadata',()=>{
 fc.assert(fc.property(fc.record({nested:fc.boolean(),stem:fc.constantFrom('src/index','src/deep/item','src/a.b','src/space name','src/雪'),output:fc.constantFrom('.vibe/declarations','types','generated declarations/雪'),inherited:fc.boolean(),configDir:fc.boolean(),bare:fc.boolean(),oldExists:fc.boolean(),pattern:fc.boolean()}),layoutCase),{seed:870051,numRuns:200})
})
test('mixed-layout sidecar wildcards are retained with an explicit warning',()=>{
 const root=mkdtempSync(join(tmpdir(),'sidecar-export-mixed-'))
 try {
  put(root,'package.json',JSON.stringify({name:'mixed',exports:{'./*':{types:'./src/*.d.vibe.ts',default:'./dist/*.js'}}}))
  put(root,'tsconfig.json',JSON.stringify({vibe:{sidecarDir:'.vibe/declarations'}}))
  put(root,'src/index.vibe','export const value = 1');put(root,'src/authored.d.vibe.ts','export interface Authored {}')
  mkdirSync(join(root,'node_modules'),{recursive:true});symlinkSync(join(repo,'packages/runtime/node_modules/typescript'),join(root,'node_modules/typescript'),'dir')
  const tracked=['package.json','tsconfig.json','src/index.vibe','src/authored.d.vibe.ts'],before=readFileSync(join(root,'package.json'),'utf8'),warnings=[]
  assert.deepEqual(C.refreshSidecarExports(root,tracked,new Set(['tsconfig.json']),{onWarning:w=>warnings.push(w)}),[])
  assert.equal(readFileSync(join(root,'package.json'),'utf8'),before);assert.ok(warnings.some(w=>/more than one layout/.test(w)))
 } finally {rmSync(root,{recursive:true,force:true})}
})

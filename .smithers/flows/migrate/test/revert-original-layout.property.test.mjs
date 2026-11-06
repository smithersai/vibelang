import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {test} from 'node:test'
import {makeConfig,paths,revertMany} from '../lib/steps.mjs'
import {renameBatch} from '../lib/codemod.mjs'
import * as Jj from '../lib/jj.mjs'
import {must,writeJson} from '../lib/util.mjs'
const require=createRequire(new URL('../../../../packages/runtime/package.json',import.meta.url))
const fc=require('fast-check'), realTypeScript=require.resolve('typescript')
const corpus=JSON.parse(readFileSync(new URL('./corpus/opencode-revert-original-layout.json',import.meta.url),'utf8'))
async function returned({count=3,mirror=corpus.sidecarDir,explicit=false}) {
 const home=mkdtempSync(join(tmpdir(),'revert-original-layout-')),target=join(home,'repo'),run=join(home,'run')
 const put=(file,text)=>{mkdirSync(dirname(join(target,file)),{recursive:true});writeFileSync(join(target,file),typeof text==='string'?text:JSON.stringify(text))}
 try {
  put('package.json',{name:'fixture',private:true,type:'module'})
  put('.gitignore','node_modules/\ntypes/\nnested/\n**/*.d.vibe.ts\n')
  const native=Array.from({length:count},(_,i)=>`src/value${i}.ts`)
  const cfg={compilerOptions:{noEmit:true,noLib:true,module:'Preserve',moduleResolution:'Bundler',...(explicit?{rootDir:'src'}:{})},vibe:{sidecarDir:mirror,effectGlobals:false,effectModules:false},files:native}
  put('tsconfig.json',cfg)
  for(const [i,f]of native.entries())put(f,`export const value${i} = ${i}\n`)
  put('node_modules/typescript/package.json',{name:'typescript',version:'5.9.3',main:'index.cjs'})
  put('node_modules/typescript/index.cjs',`const api=require(${JSON.stringify(realTypeScript)});module.exports=new Proxy(api,{get(api,key){if(key==='createProgram')return(...args)=>{globalThis.__revertLayoutCreates=(globalThis.__revertLayoutCreates??0)+1;return api.createProgram(...args)};return Reflect.get(api,key)}})`)
  await must('jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost',{cwd:target})
  await Jj.commit(target,'original source')
  const renames=renameBatch(target,native),p=paths(run)
  put('tsconfig.json',{...cfg,files:renames.map(r=>r.to)})
  for(const [i,r]of renames.entries()){
   put(`${mirror}/value${i}.d.vibe.ts`,`export declare const value${i}: ${i};\n`)
   put(`${mirror}/src/value${i}.d.vibe.ts`,'// authored declaration from a different output layout\n')
   put(r.to+'.unrelated.d.ts','// authored declaration with no matching body\n')
  }
  writeJson(p.config,makeConfig({target,test:'true',vibelangVersion:'0.0.11'}))
  writeJson(p.plan,{batches:[{files:native}]})
  writeJson(p.codemod('01'),{renames,importEdits:[],refEdits:renames.map(r=>({file:'tsconfig.json',from:r.from,to:r.to,module:r.from}))})
  globalThis.__revertLayoutCreates=0
  const result=await revertMany({run,batch:'01',files:renames.map(r=>({file:r.to,reason:'restore original source'}))})
  assert.equal(result.length,count)
  const progress=readFileSync(join(p.batch('01'),'logs/revert-progress.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line))
  assert.equal(progress.at(-1).stage,'complete')
  assert.equal(progress.at(-1).files,count)
  assert.equal(progress.filter(row=>row.stage==='prepared').length,count)
  assert.equal(progress.find(row=>row.stage==='restore').projects,1)
  for(const [i,r]of renames.entries()){
   assert.equal(readFileSync(join(target,r.from),'utf8'),`export const value${i} = ${i}\n`)
   assert.equal(existsSync(join(target,r.to)),false)
   assert.equal(existsSync(join(target,`${mirror}/value${i}.d.vibe.ts`)),false,'remove the output owned before restoring source files')
   assert.equal(readFileSync(join(target,`${mirror}/src/value${i}.d.vibe.ts`),'utf8'),'// authored declaration from a different output layout\n')
   assert.ok(existsSync(join(target,r.to+'.unrelated.d.ts')))
  }
  assert.ok(globalThis.__revertLayoutCreates<=1,`one stable project required ${globalThis.__revertLayoutCreates} layout programs`)
 } finally {rmSync(home,{recursive:true,force:true});delete globalThis.__revertLayoutCreates}
}
test('revert removes the original inferred-root output and preserves another layout',()=>returned({count:3}))
test('bulk reverts share the original layout across nested directories and root modes',async()=>{
 await fc.assert(fc.asyncProperty(fc.integer({min:2,max:6}),fc.constantFrom('types','nested/types'),fc.boolean(),async(count,mirror,explicit)=>returned({count,mirror,explicit})),{seed:1066,numRuns:12})
})

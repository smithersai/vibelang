import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {test} from 'node:test'
import {addSourceChildLoaders} from '../lib/source-children.mjs'
const require=createRequire(new URL('../../../../packages/runtime/package.json',import.meta.url))
const ts=require('typescript'),fc=require('fast-check')
const corpus=JSON.parse(readFileSync(new URL('./corpus/opencode-shell-non-source-argv.json',import.meta.url)))
test('opencode: a shell launch with finite non-source argv stays byte-identical',()=>{
 const r=addSourceChildLoaders(corpus.native,ts)
 assert.equal(r.text,corpus.native);assert.equal(r.usesChild,false);assert.deepEqual(r.refusals,[])
})
test('setup removes its earlier unnecessary shell wrapper and helper',()=>{
 const r=addSourceChildLoaders(corpus.legacy,ts)
 assert.equal(r.text,corpus.native);assert.equal(r.usesChild,false);assert.deepEqual(r.refusals,[])
 assert.equal(addSourceChildLoaders(r.text,ts).text,r.text)
})
test('property: finite non-source CLI strings never add a loader or alter authored code',()=>{
 fc.assert(fc.property(fc.array(fc.constantFrom('-il','-l','-c','env -0','entry.js','entry.mjs','--','run','--eval','console.log(42)'),{maxLength:6}),fc.boolean(),fc.boolean(),(values,constant,namespace)=>{
  const head=namespace?'import * as Child from "node:child_process";':'import {spawnSync} from "node:child_process";'
  const callee=namespace?'Child.spawnSync':'spawnSync'
  const args='[mode'+values.map(v=>','+JSON.stringify(v)).join('')+']'
  const code=head+'\nexport function launch(command: string, mode: "-l" | "-il") {'+(constant?'const argv='+args+';':'')+'return '+callee+'(command,'+(constant?'argv':args)+')}\n'
  const r=addSourceChildLoaders(code,ts)
  assert.equal(r.text,code);assert.equal(r.usesChild,false);assert.deepEqual(r.refusals,[])
 }),{seed:860051,numRuns:200})
})
test('unknown or possibly typed source arguments still receive preloads',()=>{
 for(const type of ['string','"entry.ts" | "entry.js"','"entry.vibe" | "entry.mjs"']) {
  const code='import {spawnSync} from "node:child_process"; export function launch(command: string, entry: '+type+') {return spawnSync(command,[entry])}'
  const r=addSourceChildLoaders(code,ts)
  assert.equal(r.usesChild,true);assert.notEqual(r.text,code);assert.deepEqual(r.refusals,[])
 }
})
test('manually observed or modified old helpers are retained with located warnings',()=>{
 for(const text of [corpus.legacy+'\nexport {__vibelangSourceChild};\n',corpus.legacy.replace('const unchanged:', '/* hand change */ const unchanged:')]) {
  const r=addSourceChildLoaders(text,ts)
  assert.equal(r.text,text);assert.ok(r.refusals.some(r=>r.line>0))
 }
})

test('property: owned legacy and namespace helpers prune in TS and JS with fresh names',()=>{
 fc.assert(fc.property(fc.boolean(),fc.constantFrom('alias','namespace-alias','namespace-fresh'),fc.integer({min:0,max:12}),(javascript,style,index)=>{
  const original=javascript?corpus.javascriptNative:corpus.native
  let legacy=javascript?corpus.javascriptLegacy:corpus.legacy
  const suffix=index?String(index+1):''
  const url=(style==='namespace-fresh'?'__vibelangNodeURL':'__vibelangFileURLToPath')+suffix
  legacy=legacy.replaceAll('__vibelangSourceChild','__vibelangSourceChild'+suffix).replaceAll('__vibelangFileURLToPath',url)
  if(style!=='alias')legacy=legacy.replace('import { fileURLToPath as '+url+' }','import * as '+url).replaceAll(url+'(',url+'.fileURLToPath(')
  const r=addSourceChildLoaders(legacy,ts,{file:javascript?'probe.mjs':'probe.ts'})
  assert.equal(r.text,original);assert.equal(r.usesChild,false);assert.deepEqual(r.refusals,[])
 }),{seed:860052,numRuns:120})
})

test('legacy pruning preserves generated-file and CommonJS boundaries',()=>{
 const generated='// @generated; do not edit\n'+corpus.legacy
 const a=addSourceChildLoaders(generated,ts)
 assert.equal(a.text,generated);assert.ok(a.refusals.some(r=>/generated/.test(r.reason)))
 const b=addSourceChildLoaders(corpus.javascriptLegacy,ts,{file:'probe.cjs',type:'commonjs'})
 assert.equal(b.text,corpus.javascriptLegacy);assert.ok(b.refusals.some(r=>/CommonJS/.test(r.reason)))
})

test('an unnecessary legacy call is unwrapped while a typed-source sibling keeps its helper',()=>{
 const mixed=JSON.parse(readFileSync(new URL('./corpus/opencode-mixed-source-child-argv.json',import.meta.url)))
 const original=corpus.legacy.replace('return spawnSync(', 'spawnSync(...__vibelangSourceChild(shell, ['+JSON.stringify(mixed.typedEntry)+'])); return spawnSync(')
 assert.notEqual(original,corpus.legacy)
 const r=addSourceChildLoaders(original,ts)
 assert.equal(r.usesChild,true);assert.deepEqual(r.refusals,[])
 assert.ok(r.text.includes('return spawnSync(shell, [mode, "-c", "env -0"])'))
 assert.ok(r.text.includes('spawnSync(...__vibelangSourceChild(shell, ["entry.ts"]))'))
 assert.equal(addSourceChildLoaders(r.text,ts).text,r.text)
})


test('property: mixed legacy shell and source calls normalize in one pass',()=>{
 fc.assert(fc.property(fc.boolean(),fc.constantFrom('alias','namespace-alias','namespace-fresh'),fc.integer({min:0,max:12}),fc.constantFrom('entry.ts','entry.mts','entry.vibe','entry.tsx'),(javascript,style,index,entry)=>{
  let legacy=javascript?corpus.javascriptLegacy:corpus.legacy
  legacy=legacy.replace('return spawnSync(', 'spawnSync(...__vibelangSourceChild(shell, ['+JSON.stringify(entry)+'])); return spawnSync(')
  const suffix=index?String(index+1):''
  const url=(style==='namespace-fresh'?'__vibelangNodeURL':'__vibelangFileURLToPath')+suffix
  const helper='__vibelangSourceChild'+suffix
  legacy=legacy.replaceAll('__vibelangSourceChild',helper).replaceAll('__vibelangFileURLToPath',url)
  if(style!=='alias')legacy=legacy.replace('import { fileURLToPath as '+url+' }','import * as '+url).replaceAll(url+'(',url+'.fileURLToPath(')
  const options={file:javascript?'probe.mjs':'probe.ts'}
  const r=addSourceChildLoaders(legacy,ts,options)
  assert.equal(r.usesChild,true);assert.deepEqual(r.refusals,[])
  const native=javascript?corpus.javascriptNative:corpus.native
  const shell=/return (spawnSync\([^;]*?\))/.exec(native)
  assert.ok(shell,'native shell fixture')
  assert.ok(r.text.includes('return '+shell[1]))
  assert.ok(r.text.includes('spawnSync(...'+helper+'(shell, ['+JSON.stringify(entry)+']))'))
  assert.ok(r.text.includes('import * as '+url+' from "node:url"'))
  assert.equal(addSourceChildLoaders(r.text,ts,options).text,r.text)
 }),{seed:860053,numRuns:150})
})

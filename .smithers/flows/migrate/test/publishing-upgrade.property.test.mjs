import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { rewritePublishingScript } from "../lib/publishing.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-owned-packer-upgrade.json",import.meta.url)))
const rule="`x.vibe` emits `x.js` beside `x.d.ts` in `outDir`"
function execute(text,pkg) {
 const out={}
 const result=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true})
 assert.deepEqual(result.diagnostics,[])
 new Function("exports",result.outputText)(out)
 return out.map(pkg)
}
function check({stem,condition,legacy,javascript,extension,migrated=true}) {
 const native='./src/'+stem+'.'+extension,source=migrated?'./src/'+stem+'.vibe':native
 const wrapper=legacy && migrated?{types:'./src/'+stem+'.d.vibe.ts',default:source}:{types:native,'vibelang-source':source,default:'./.vibelang/js/src/'+stem+'.js'}
 const before={exports:{'.':native,'./asset':'./data.json','./none':null},imports:{'#leaf':{types:native,[condition]:native},'#asset':{default:'./asset.js'}}}
 const after=structuredClone(before)
 after.exports['.']=structuredClone(wrapper)
 for(const key of Object.keys(after.imports['#leaf']))after.imports['#leaf'][key]=structuredClone(wrapper)
 const saved=structuredClone(after)
 let old=corpus.legacy,nativeScript=corpus.source
 if(javascript){old=ts.transpileModule(old,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;nativeScript=ts.transpileModule(nativeScript,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText}
 const file=javascript?'pack.mjs':'pack.ts'
 const upgraded=rewritePublishingScript(old,ts,file)
 assert.ok(upgraded.text.startsWith(old.slice(0,old.indexOf('const imports'))),'previously generated export wiring is byte-identical')
 assert.equal(upgraded.changed,true,'setup must upgrade already-expanded path mappers')
 assert.deepEqual(execute(upgraded.text,after),execute(nativeScript,before),'existing JS/types/condition policy survives upgrade')
 assert.deepEqual(after,saved,'workspace manifest remains unchanged')
 assert.equal(rewritePublishingScript(upgraded.text,ts,file).text,upgraded.text,'upgraded helper is byte-idempotent')
 const fresh=rewritePublishingScript(nativeScript,ts,file)
 assert.deepEqual(execute(upgraded.text,after),execute(fresh.text,after),'fresh and upgraded setup agree')
}
test('publication upgrade oracle quotes Chapter 7',()=>assert.ok(readFileSync(new URL('../../../../docs/design/src/007-tooling.md',import.meta.url),'utf8').includes(rule)))
test('opencode: an old generated packer upgrades nested import conditions',()=>check({stem:'leaf',condition:'node',legacy:false,javascript:false,extension:'ts'}))
test('property: already-expanded publication helpers upgrade without changing native policy',async()=>{
 await checkProperty(fc,{name:'opencode-owned-packer-upgrade',rule,command:'node --test test/publishing-upgrade.property.test.mjs',arbitrary:fc.record({stem:fc.constantFrom('leaf','nested/index','space name','雪'),condition:fc.constantFrom('node','bun','default','development'),legacy:fc.boolean(),javascript:fc.boolean(),migrated:fc.boolean(),extension:fc.constantFrom('ts','tsx')}),check,numRuns:160,generatorVersion:1,regressions:new URL('./corpus/',import.meta.url)})
})

test('already-expanded unsupported or shadowed publication helpers remain unchanged',()=>{
 for(const old of [corpus.legacy+'\noutput = custom; declaration = custom;\n','const Object = other;\n'+corpus.legacy]) {
  assert.equal(rewritePublishingScript(old,ts).text,old)
 }
 const arbitrary='export const transform = (value: string) => value.replace(/\\.(?:tsx?|vibe)$/, ".js")'
 assert.equal(rewritePublishingScript(arbitrary,ts).text,arbitrary)
})

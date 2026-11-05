import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { testBundleDeferrals } from "../lib/test-bundles.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-prisma-optional-peers-packages-external.json", import.meta.url)))
const rejectPlugin = '{name:"reject-optional-runtime",setup(build){build.onResolve({filter:/^optional-runtime/},args=>{throw new Error(args.path);});}}'
function fixture(source = corpus.source) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-packages-external-"))
  const put = (file, text) => { mkdirSync(dirname(join(root,file)), {recursive:true}); writeFileSync(join(root,file),text) }
  for (const [file,text] of Object.entries(corpus.files)) put(file,text)
  put(corpus.test, source)
  const files = [corpus.entry,corpus.local,corpus.dependency]
  return { root,put,files,retained() { return testBundleDeferrals(root,files).map(r=>r.file).sort() },dispose(){rmSync(root,{recursive:true,force:true})} }
}
const call = fields => 'Bun.build({entrypoints:['+JSON.stringify(corpus.entry)+'],target:"bun",'+fields+'});'
const internal = [corpus.entry,corpus.local].sort()
// docs/user/src/setup/migrating-retired-forms.md: "It never edits a test or a fixture".
// The unchanged bundling test remains the runtime oracle. Only source edges
// Bun actually follows require native wiring; external packages are boundaries.
test("packages external: the Alchemy optional-peer shape retains local source and releases package dependencies", () => {
  const f=fixture()
  try {
    assert.deepEqual(f.retained(),internal)
    assert.equal(readFileSync(join(f.root,corpus.test),"utf8"),corpus.source)
  } finally {f.dispose()}
})
test("packages external: plain calls and rejecting resolver hooks exclude bare dependencies", () => {
  for(const fields of ['packages:"external"', '["packages"]:("external" as const)', 'packages:"external",plugins:[]', 'packages:"external",plugins:['+rejectPlugin+']']){
    const f=fixture(call(fields))
    try{assert.deepEqual(f.retained(),internal,fields)}finally{f.dispose()}
  }
})
test("packages external: unknown options, mutating plugins and redirecting resolvers keep the conservative graph", () => {
  for(const source of [
    call('packages:"bundle"'),call('plugins:[{name:"unrelated",packages:"external"}]'),
    call('packages:"external",...unknown'),
    call('packages:"external",get target(){this.packages="bundle";return "bun"}'),
    call('packages:"external",plugins:[factory()]'),
    call('packages:"external",plugins:[{name:"mutate",setup(build){build.config.packages="bundle";}}]'),
    call('packages:"external",plugins:[{name:"resolve",setup(build){build.onResolve({filter:/engine/},args=>({path:args.path}));}}]'),
    'const options={entrypoints:['+JSON.stringify(corpus.entry)+'],packages:"external"};options.packages="bundle";Bun.build(options);',
    'import {rolldown} from "rolldown";rolldown({input:'+JSON.stringify(corpus.entry)+',packages:"external"});'
  ]){
    const f=fixture(source)
    try{assert.deepEqual(f.retained(),[...f.files].sort(),source)}finally{f.dispose()}
  }
})
test("packages external: aliases, relative crossings and later internal bundles still retain their dependencies", () => {
  for(const kind of ["alias","relative","second-bundle"]){
    const f=fixture(call('packages:"external"'))
    try{
      if(kind==="alias"){
        f.put("packages/prisma/tsconfig.json",JSON.stringify({compilerOptions:{baseUrl:".",paths:{"engine/*":["../engine/src/*.ts"]}}}))
        f.put(corpus.entry,'import {execute} from "engine/Command/Exec";import {local} from "./Local.ts";export const run=()=>execute()+local;')
      }else if(kind==="relative"){
        f.put(corpus.entry,'import {execute} from "../../engine/src/Command/Exec.ts";import {local} from "./Local.ts";export const run=()=>execute()+local;')
      }else f.put(corpus.test,call('packages:"external"')+"\n"+call('packages:"bundle"'))
      assert.deepEqual(f.retained(),[...f.files].sort(),kind)
    }finally{f.dispose()}
  }
})
test("packages external: Bun runtime agrees on external packages, relative source and resolver overrides", () => {
  const f=fixture()
  try{
    mkdirSync(join(f.root,"node_modules"),{recursive:true})
    symlinkSync("../packages/engine",join(f.root,"node_modules/example-engine"))
    const run=(fields,entry=corpus.entry)=>spawnSync("bun",["--eval",'const r=await Bun.build({entrypoints:['+JSON.stringify(entry)+'],target:"bun",write:false,'+fields+'});if(!r.success)process.exit(2);'],{cwd:f.root,encoding:"utf8",timeout:30000})
    assert.equal(run("").status,0,"stock TypeScript control")
    f.put("packages/engine/src/Command/Exec.vibe","export const execute = effect { return 1 }")
    f.put("packages/engine/package.json",JSON.stringify({name:"example-engine",exports:{"./*":"./src/*.vibe"}}))
    assert.equal(run('packages:"external"').status,0,"external native dependency is not loaded")
    assert.equal(run('packages:"external",plugins:['+rejectPlugin+']').status,0,"reject-only hook keeps that boundary")
    f.put("packages/engine/src/Self.ts",'import {execute} from "example-engine/Command/Exec";export const run=execute;')
    assert.equal(run('packages:"external"',"packages/engine/src/Self.ts").status,0,"bare self references remain external too")
    assert.notEqual(run("").status,0,"an unconfigured native dependency still fails when bundled")
    assert.notEqual(run('packages:"external",plugins:[{name:"mutate",setup(build){build.config.packages="bundle";}}]').status,0,"a plugin can change the package policy")
  }finally{f.dispose()}
})
test("packages external: property preserves reachable relative edges and cuts only proven package boundaries", () => {
  fc.assert(fc.property(
    fc.array(fc.array(fc.record({target:fc.nat(15),bare:fc.boolean()}),{maxLength:4}),{minLength:1,maxLength:7}),
    fc.boolean(),fc.boolean(),fc.constantFrom("plain","reject","unknown"),
    (raw,external,wrapped,plugin)=>{
      const f=fixture("export {}")
      try{
        const graph=raw.map(edges=>edges.map(e=>({...e,target:e.target%raw.length})))
        const files=graph.map((_,i)=>"packages/engine/src/Node"+i+".ts")
        graph.forEach((edges,i)=>f.put(files[i],edges.map(e=>'import "'+(e.bare?'example-engine/Node'+e.target:'./Node'+e.target+'.ts')+'";').join("\n")+"\nexport const value=1;"))
        const mode=external?(wrapped?'("external" as const)':'"external"'):'"bundle"'
        const plugins=plugin==="reject"?",plugins:["+rejectPlugin+"]":plugin==="unknown"?",plugins:[factory()]":""
        f.put(corpus.test,'Bun.build({entrypoints:['+JSON.stringify(files[0])+'],packages:'+mode+plugins+'});')
        const expected=new Set(),todo=[0],cut=external&&plugin!=="unknown"
        while(todo.length){const i=todo.pop();if(expected.has(i))continue;expected.add(i);for(const e of graph[i])if(!cut||!e.bare)todo.push(e.target)}
        const actual=testBundleDeferrals(f.root,files).map(r=>r.file).sort()
        assert.deepEqual(actual,[...expected].map(i=>files[i]).sort())
      }finally{f.dispose()}
    }),{seed:512272,numRuns:240})
})

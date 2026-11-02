import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const fc=createRequire(join(repo,"packages/runtime/package.json"))("fast-check")
const scratch=process.env.TMPDIR || "/tmp"
const rule="Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."
const write=(root,path,text)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
const run=(cwd,cmd,args)=>{
  const r=spawnSync(cmd,args,{cwd,encoding:"utf8",timeout:60000})
  assert.equal(r.status,0,[cmd,...args].join(" ")+"\n"+r.stdout+r.stderr)
  return r.stdout
}
test("packing oracle quotes the tooling spec",()=>assert.ok(readFileSync(join(repo,"docs/design/src/007-tooling.md"),"utf8").includes(rule)))

function fixture(input,{installed=false}={}) {
  const root=mkdtempSync(join(scratch,"opencode-pack-"))
  try {
    const pkg=join(root,"pkg")
    const stem=input.stem??"index"
    const original={name:"opencode-pack-repro",version:"1.0.0",type:"module",exports:{".":"./dist/"+stem+".js"}}
    if(input.files) original.files=["dist"]
    write(pkg,"package.json",JSON.stringify(original))
    write(pkg,"dist/"+stem+".js","export const answer = 42\n")
    write(pkg,".vibelang/js/dist/"+stem+".js","export { answer } from './leaf.js'\n")
    write(pkg,".vibelang/js/dist/leaf.js","export const answer = 42\n")
    write(pkg,".vibelang/js/.loader/tsconfig.json",'{"version":1}\n')
    write(pkg,".vibelang/cache/private.json",'{"private":true}\n')
    write(pkg,"secret.txt","private\n")
    write(pkg,".gitignore","secret.txt\n.vibelang/\n")
    if(input.ignore==="npm")write(pkg,".npmignore","secret.txt\n.vibelang/\n")
    if(input.ignore==="nested"){
      write(pkg,".vibelang/.npmignore","*\n")
      write(pkg,".vibelang/js/.gitignore","*\n")
      write(pkg,".vibelang/js/dist/.npmignore","*\n")
      write(pkg,".vibelang/js/.loader/.npmignore","*\n")
    }
    const originals=new Map([".npmignore",".vibelang/.npmignore",".vibelang/js/.npmignore",".vibelang/js/dist/.npmignore",".vibelang/js/.loader/.npmignore"].map(f=>[f,existsSync(join(pkg,f))?readFileSync(join(pkg,f),"utf8"):undefined]))
    const pack=()=>{
      const tgz=join(root,"packed.tgz")
      if(input.packer==="bun")run(pkg,"bun",["pm","pack","--ignore-scripts","--filename",tgz])
      else {
        const json=JSON.parse(run(pkg,"npm",["pack","--ignore-scripts","--json","--pack-destination",root]))
        run(root,"mv",[join(root,json[0].filename),tgz])
      }
      const files=run(root,"tar",["-tzf",tgz]).split("\n")
      assert.ok(!files.some(f=>/secret.txt|private.json|pack-policy.json/.test(f)),files.join("\n"))
      return {tgz,files}
    }
    // A valid unchanged native package imports from its dist entry.
    if(installed){
      const {tgz}=pack()
      const native=join(root,"native");write(native,"package.json",'{"private":true,"type":"module"}')
      run(native,"npm",["install","--offline","--ignore-scripts","--no-audit","--no-fund",tgz])
      for(const command of ["node","bun"])assert.equal(run(native,command,["--input-type=module","-e",'import { answer } from "opencode-pack-repro"; console.log(answer)']).trim(),"42")
    }
    assert.equal(routeEmittedExports(pkg,{["./dist/"+stem+".js"]:"./.vibelang/js/dist/"+stem+".js"}),true)
    const once=readFileSync(join(pkg,"package.json"),"utf8")
    assert.equal(routeEmittedExports(pkg,{["./dist/"+stem+".js"]:"./.vibelang/js/dist/"+stem+".js"}),false)
    assert.equal(readFileSync(join(pkg,"package.json"),"utf8"),once)
    const {tgz,files}=pack()
    for(const file of [".vibelang/js/dist/"+stem+".js",".vibelang/js/dist/leaf.js",".vibelang/js/.loader/tsconfig.json"])assert.ok(files.includes("package/"+file),"tarball missing "+file+"\n"+files.join("\n"))
    if(installed){
      const consumer=join(root,"consumer");write(consumer,"package.json",'{"private":true,"type":"module"}')
      run(consumer,"npm",["install","--offline","--ignore-scripts","--no-audit","--no-fund",tgz])
      for(const command of ["node","bun"])assert.equal(run(consumer,command,["--input-type=module","-e",'import { answer } from "opencode-pack-repro"; console.log(answer)']).trim(),"42")
    }
    routeEmittedExports(pkg,{}, {restore:true})
    assert.deepEqual(JSON.parse(readFileSync(join(pkg,"package.json"),"utf8")),original)
    for(const [file,content] of originals)assert.equal(existsSync(join(pkg,file))?readFileSync(join(pkg,file),"utf8"):undefined,content,"restore "+file)
  } finally {rmSync(root,{recursive:true,force:true})}
}
for(const packer of ["npm","bun"])test("opencode: installed "+packer+" tarball retains emitted JS and loader records",()=>fixture({files:true,ignore:"npm",packer},{installed:true}))
for(const files of [false,true])for(const ignore of ["git","npm","nested"])for(const packer of ["npm","bun"])
 test("packing matrix "+JSON.stringify({files,ignore,packer}),()=>fixture({files,ignore,packer}))
test("property: package allowlists and nested ignores retain only public emitted files",async()=>{
 await checkProperty(fc,{name:"opencode-emitted-pack",rule,command:"node --test test/emitted-pack.property.test.mjs",arbitrary:fc.record({files:fc.boolean(),ignore:fc.constantFrom("git","npm","nested"),packer:fc.constantFrom("npm","bun"),stem:fc.constantFrom("index","entry space","雪","a..b")}),check:fixture,numRuns:40,regressions:new URL("./corpus/",import.meta.url)})
})

test("packing restore preserves authored allowlist entries and concurrent ignore edits across re-emits",()=>{
 const root=mkdtempSync(join(scratch,"opencode-pack-restore-"))
 try{
  write(root,"package.json",JSON.stringify({exports:"./src/index.ts",files:["dist"]}))
  write(root,".gitignore","secret.txt\n.vibelang/\n")
  const outputs={"./src/index.ts":"./.vibelang/js/src/index.js"}
  routeEmittedExports(root,outputs)
  const manifest=JSON.parse(readFileSync(join(root,"package.json"),"utf8"))
  manifest.files.push("public")
  write(root,"package.json",JSON.stringify(manifest))
  // emitPackageJs deletes only js/, so packing ownership must survive there.
  rmSync(join(root,".vibelang/js"),{recursive:true,force:true})
  routeEmittedExports(root,outputs)
  routeEmittedExports(root,{}, {restore:true})
  assert.deepEqual(JSON.parse(readFileSync(join(root,"package.json"),"utf8")).files,["dist","public"])
  write(root,"package.json",JSON.stringify({exports:"./src/index.ts"}))
  routeEmittedExports(root,outputs)
  const ignore=readFileSync(join(root,".npmignore"),"utf8")
  write(root,".npmignore",ignore+"author-private.txt\n")
  routeEmittedExports(root,{}, {restore:true})
  assert.equal(readFileSync(join(root,".npmignore"),"utf8"),"secret.txt\n.vibelang/\nauthor-private.txt\n")
  assert.equal(existsSync(join(root,".vibelang/pack-policy.json")),false)
 }finally{rmSync(root,{recursive:true,force:true})}
})

test("routing no emitted runtime leaves packing untouched, and authored js allowlists survive restore",()=>{
 const root=mkdtempSync(join(scratch,"opencode-pack-native-"))
 try{
  write(root,"package.json",JSON.stringify({exports:"./src/index.ts",files:["dist",".vibelang/js"]}))
  assert.equal(routeEmittedExports(root,{}),false)
  assert.equal(existsSync(join(root,".npmignore")),false)
  routeEmittedExports(root,{"./src/index.ts":"./.vibelang/js/src/index.js"})
  routeEmittedExports(root,{}, {restore:true})
  assert.deepEqual(JSON.parse(readFileSync(join(root,"package.json"),"utf8")).files,["dist",".vibelang/js"])
 }finally{rmSync(root,{recursive:true,force:true})}
})

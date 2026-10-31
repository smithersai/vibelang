import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname,join,posix} from "node:path"
import {test} from "node:test"
import {fileURLToPath} from "node:url"
import fc from "fast-check"
import {checkProperty} from "../../../scripts/testing/property.mjs"
import {loadTypeScript} from "../../../.smithers/flows/migrate/lib/declarations.mjs"
import {resolveRelative} from "../../../.smithers/flows/migrate/lib/imports.mjs"
import {rewriteSpecifier} from "../../../.smithers/flows/migrate/lib/codemod.mjs"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const ts=loadTypeScript([join(repo,"packages/runtime")])
const tick=String.fromCharCode(96)
const quote=tick+".vibe"+tick+" is a supported source extension"
let diagnostics=""
function pattern(input){
 const importer="pkg/main.vibe"
 const prefixes={local:"./"+input.name+"/",parent:"../"+input.name+"/",self:"./",ancestor:"../"}
 const specifier=prefixes[input.relation]
 const source=posix.normalize(posix.join(posix.dirname(importer),specifier,"index.ts"))
 const target=source.slice(0,-3)+input.extension
 return{importer,specifier,source,target}
}
test("directory import oracle quotes the current specification",()=>{
 assert.ok(readFileSync(join(repo,"docs/design/src/007-tooling.md"),"utf8").includes(quote))
})
test("directory resolution and source spelling agree with TypeScript across canonical path boundaries",async()=>{
 await checkProperty(fc,{
  name:"migrate-relative-source-resolution",
  rule:"VIP-27; docs/design/src/007-tooling.md: "+quote+"; directory index imports keep their selected module",
  command:"node --test directory-imports.property.test.mjs",
  regressions:new URL("./property-regressions/",import.meta.url),numRuns:120,
  arbitrary:fc.record({name:fc.constantFrom("runtime","stats.core","core-space"),relation:fc.constantFrom("local","parent","self","ancestor"),extension:fc.constantFrom(".ts",".tsx",".vibe")}),
  artifacts:input=>{const p=pattern(input);return{[p.importer]:"export * as Runtime from "+JSON.stringify(p.specifier)+"\n",[p.target]:"export const value = 42\n"}},
  diagnostics:()=>diagnostics,
  check:input=>{
   const root=mkdtempSync(join(tmpdir(),"opencode-directory-imports-"))
   try{
    const p=pattern(input)
    mkdirSync(dirname(join(root,p.source)),{recursive:true})
    mkdirSync(dirname(join(root,p.importer)),{recursive:true})
    writeFileSync(join(root,p.source),"export const value = 42\n")
    const options={module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowArbitraryExtensions:true,allowImportingTsExtensions:true,noEmit:true,jsx:ts.JsxEmit.Preserve}
    const resolve=text=>ts.resolveModuleName(text,join(root,p.importer),options,ts.sys).resolvedModule?.resolvedFileName
    assert.equal(resolve(p.specifier),join(root,p.source),"stock TypeScript selects the directory index")
    if(p.target!==p.source)renameSync(join(root,p.source),join(root,p.target))
    const expected=input.extension===".vibe"?p.target.slice(0,-5)+".d.vibe.ts":p.target
    if(input.extension===".vibe")writeFileSync(join(root,expected),"export declare const value: 42\n")
    const selected=resolveRelative(p.importer,p.specifier,new Set([p.target]))
    diagnostics=JSON.stringify({input,...p,selected})
    assert.equal(selected,p.target,"the graph records a canonical repository key")
    const rewritten=rewriteSpecifier(p.importer,p.specifier,selected)
    assert.equal(resolve(rewritten),join(root,expected),"rewritten directory imports name the same module or its sidecar")
    assert.equal(rewriteSpecifier(p.importer,rewritten,selected),rewritten,"source spelling is idempotent")
   }finally{rmSync(root,{recursive:true,force:true})}
  }
 })
})

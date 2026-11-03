// VIP-27 resolved module identity across specifier spellings.
// VIP-27 resolved module identity across specifier spellings: docs/design/vips/0027-declaration-output.md#b68d99728039c6d2
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { compareDeclarations as draft, loadTypeScript } from "../../../.smithers/flows/migrate/lib/declarations.mjs"
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const ts = loadTypeScript([join(repo,"packages/runtime")])
function trees(input, mode, check) {
 const root=mkdtempSync(join(tmpdir(),"opencode-dts-targets-"))
 try {
  const importer="api/index.d.ts"
  const stem=(input.parent?"":"api/")+input.name
  const target=stem+(input.directory?"/index":"")+".d.ts"
  const bare=(input.parent?"../":"./")+input.name+(input.slash&&input.directory?"/":"")
  const source=(input.parent?"../":"./")+input.name+(input.directory?"/index":"")+".js"
  const statement=specifier => input.form==="namespace" ? 'export * as Runtime from '+JSON.stringify(specifier)+';\n' : 'export { value } from '+JSON.stringify(specifier)+';\n'
  for(const side of ["before","after"]) {
   const entries={
    [target]:"export declare const value: 42;\n",
    "api/other.d.ts":"export declare const value: 42;\n",
    [importer]: statement(side==="before"?bare:source)+'export type Label = "./runtime";\n'
   }
   if(mode==="changed-target"&&side==="after")entries[importer]=statement("./other.js")+'export type Label = "./runtime";\n'
   if(mode==="changed-type"&&side==="after")entries[target]="export declare const value: string;\n"
   if(mode==="type-literal"&&side==="after")entries[importer]=statement(source)+'export type Label = "./runtime.js";\n'
   if(mode==="explicit-extensions")entries[importer]=statement(side==="before"?"./runtime.jsx":"./runtime.js")
   if(mode==="missing")entries[importer]=statement(side==="before"?"./missing":"./missing.js")
   if(mode==="external")entries[importer]=statement(side==="before"?"external":"external.js")
   if(mode==="outside") {
    entries["../../shared/runtime.d.ts"]="export declare const value: 42;\n"
    entries[importer]=statement(side==="before"?"../../shared/runtime":"../../shared/runtime.js")
   }
   if(mode==="shadowed") {
    entries["api/runtime.d.ts"]="export declare const value: 42;\n"
    entries["api/runtime/index.d.ts"]="export declare const value: 42;\n"
    entries[importer]=statement(side==="before"?"./runtime":"./runtime/index.js")
   }
   for(const [file,text]of Object.entries(entries)) {
    const p=join(root,side,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text.replaceAll("\\n","\n"))
   }
  }
  return check(join(root,"before"),join(root,"after"),{target,bare,source,importer})
 } finally {rmSync(root,{recursive:true,force:true})}
}
const tick=String.fromCharCode(96)
const quote=tick+"x.vibe"+tick+" emits "+tick+"x.js"+tick+" beside "+tick+"x.d.ts"+tick+" in "+tick+"outDir"+tick
test("module identity oracle quotes the current emit rule",()=>{
 assert.ok(readFileSync(join(repo,"docs/design/src/007-tooling.md"),"utf8").includes(quote))
})
test("extensionless source and emitted names keep one declaration identity",async()=>{
 await checkProperty(fc,{
  name:"migrate-source-declaration-identity",
  rule:"D298; docs/design/src/007-tooling.md: "+quote,
  command:"node --test test/declaration-module-identity.property.test.mjs",
  regressions:new URL("./property-regressions/",import.meta.url),numRuns:80,
  arbitrary:fc.record({name:fc.constantFrom("runtime","stats.core","core-space",".runtime",".hidden/runtime"),parent:fc.boolean(),directory:fc.boolean(),slash:fc.boolean(),form:fc.constantFrom("namespace","named")}),
  artifacts:input=>({"index.ts":'export * as Runtime from "./'+input.name+'"'}),
  check:input=>trees(input,"same",(a,b,p)=>{
   const options={module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler}
   const selected=(root,name)=>ts.resolveModuleName(name,join(root,p.importer),options,ts.sys).resolvedModule?.resolvedFileName
   assert.equal(selected(a,p.bare),join(a,p.target),"the source spelling selects the modeled declaration")
   assert.equal(selected(b,p.source),join(b,p.target),"the emitted name selects that same module")
   assert.equal(draft(ts,a,b).identical,true)
  })
 })
})
test("identity comparison preserves explicit names, changed modules, types and literals",()=>{
 const input={name:"runtime",parent:false,directory:false,slash:false,form:"namespace"}
 for(const mode of ["changed-target","changed-type","type-literal","missing","external","outside","shadowed","explicit-extensions"])
  trees(input,mode,(a,b)=>assert.equal(draft(ts,a,b).identical,false,mode))
})

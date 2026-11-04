// VIP-27 resolved module identity across specifier spellings.
// VIP-27 resolved module identity across specifier spellings: docs/design/vips/0027-declaration-output.md#b68d99728039c6d2
// docs/design/vips/0027-declaration-output.md#10c4b54a749cefe2
// VIP-27: migration rejects required API and module identity changes.
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
   if(mode==="changed-target-type"&&side==="after") {
    entries[importer]=statement("./other.js")+'export type Label = "./runtime";\n'
    entries["api/other.d.ts"]="export declare const value: 43;\n"
   }
   if(mode==="changed-export"&&side==="after")entries[importer]=entries[importer].replace("as Runtime","as Renamed")
   if(mode==="changed-doc")entries[target]=(side==="before"?"/** Original public documentation. */\n":"/** Changed public documentation. */\n")+entries[target]

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
const quote="Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin: the same exported names, each export's type identical to `tsc`'s in both directions (a type-level check), and the same doc comment on each export."
test("declaration comparison oracle quotes the current API identity rule",()=>{
 assert.ok(readFileSync(join(repo,"docs/design/src/001-functions.md"),"utf8").includes(quote))
})
test("extensionless source and emitted names keep one declaration identity",async()=>{
 await checkProperty(fc,{
  name:"migrate-source-declaration-identity",
  rule:"D298; docs/design/src/001-functions.md: "+quote,
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
// Source001 API identity ignores presentation when every exported name, type and doc matches.
test("API identity accepts equivalent targets and explicit extension spellings",()=>{
 const input={name:"runtime",parent:false,directory:false,slash:false,form:"namespace"}
 for(const mode of ["changed-target","shadowed","explicit-extensions"])
  trees(input,mode,(a,b)=>{
   const result=draft(ts,a,b)
   assert.equal(result.identical,true,mode)
   assert.equal(result.comparisonComplete,true,mode)
   assert.deepEqual(result.nameDifferences,[],mode)
   assert.deepEqual(result.typeDifferences,[],mode)
   assert.deepEqual(result.docDifferences,[],mode)
  })
})
test("API identity rejects real export, type, literal and documentation changes",()=>{
 const input={name:"runtime",parent:false,directory:false,slash:false,form:"namespace"}
 for(const mode of ["changed-type","type-literal","changed-target-type","changed-export","changed-doc"])
  trees(input,mode,(a,b)=>{
   const result=draft(ts,a,b)
   assert.equal(result.identical,false,mode)
   assert.equal(result.comparisonComplete,true,mode)
   const differences=mode==="changed-export"?result.nameDifferences:mode==="changed-doc"?result.docDifferences:result.typeDifferences
   assert.ok(differences.length>0,mode+": retain the specific API difference")
  })
})
test("missing, external and outside declaration targets remain unproven",()=>{
 const input={name:"runtime",parent:false,directory:false,slash:false,form:"namespace"}
 for(const mode of ["missing","external","outside"])
  trees(input,mode,(a,b)=>{
   const result=draft(ts,a,b)
   assert.equal(result.identical,false,mode)
   assert.equal(result.comparisonComplete,false,mode)
   assert.ok(result.environmentDiagnostics.length>0,mode)
  })
})

import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { loadTypeScript } from "../../../.smithers/flows/migrate/lib/declarations.mjs"
import { rewriteImports, restoreSpecifiers } from "../../../.smithers/flows/migrate/lib/codemod.mjs"
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const ts=loadTypeScript([join(repo,"packages/runtime")])
const tick=String.fromCharCode(96)
const quote="plain "+tick+"tsc"+tick+" uses the declaration."
let diagnostics=""
function pattern(input){
 const importer="pkg/index.ts"
 const stem=(input.parent?"":"pkg/")+input.name
 const target=stem+(input.directory?"/index":"")+".ts"
 let specifier=(input.parent?"../":"./")+input.name
 if(input.extension!=="none")specifier+=(input.directory?"/index":"")+"."+input.extension
 else if(input.directory&&input.slash)specifier+="/"
 const literal=JSON.stringify(specifier)
 const forms={
  namespace:"export * as Runtime from "+literal,
  export:"export { value } from "+literal,
  import:"import { value } from "+literal+"\nexport const copy = value",
  type:"import type { Value } from "+literal+"\nexport type Copy = Value",
  dynamic:"export const load = () => import("+literal+")",
  bare:"import "+literal
 }
 const source=forms[input.kind].replaceAll("\\n","\n")+"\nimport { sentinel } from \"./other\"\nexport const unchanged = sentinel\n"
 const files={[importer]:source,[target]:"export const value = 42\nexport type Value = 42\n","pkg/other.ts":"export const sentinel = 1\n"}
 return {importer,target,specifier,files}
}
test("stock sidecar import oracle quotes the current specification",()=>{
 assert.ok(readFileSync(join(repo,"docs/design/src/007-tooling.md"),"utf8").includes(quote))
})
test("migration source names keep every import form resolvable by stock TypeScript",async()=>{
 await checkProperty(fc,{
  name:"migrate-source-sidecar-imports",
  rule:"VIP-27; docs/design/src/007-tooling.md: "+quote,
  command:"node --test test/source-sidecar-imports.property.test.mjs",
  arbitrary:fc.record({name:fc.constantFrom("runtime","stats.core","core-space","mod_1",".runtime",".hidden/runtime"),parent:fc.boolean(),directory:fc.boolean(),extension:fc.constantFrom("none","js","ts"),slash:fc.constant(false),kind:fc.constantFrom("namespace","export","import","type","dynamic","bare")}),
  regressions:new URL("./property-regressions/", import.meta.url),numRuns:120,artifacts:input=>pattern(input).files,diagnostics:()=>diagnostics,
  check:input=>{
   const root=mkdtempSync(join(tmpdir(),"opencode-source-imports-"))
   try{
    const {importer,target,specifier,files}=pattern(input)
    for(const [file,contents]of Object.entries(files)){mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),contents)}
    const options={module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowArbitraryExtensions:true,allowImportingTsExtensions:true,noEmit:true}
    const resolve=text=>ts.resolveModuleName(text,join(root,importer),options,ts.sys).resolvedModule?.resolvedFileName
    assert.equal(resolve(specifier),join(root,target),"the original import names the selected .ts file")
    const vibe=target.slice(0,-3)+".vibe"
    renameSync(join(root,target),join(root,vibe))
    const sidecar=target.slice(0,-3)+".d.vibe.ts"
    writeFileSync(join(root,sidecar),"export declare const value: 42\nexport type Value = 42\n")
    const scope=[importer,vibe,"pkg/other.ts"]
    const edits=rewriteImports(root,scope)
    const relative=posix.relative(posix.dirname(importer),vibe)
    const expected=relative.startsWith("./")||relative.startsWith("../")?relative:"./"+relative
    diagnostics=JSON.stringify({input,edits,expected,text:readFileSync(join(root,importer),"utf8")})
    assert.ok(edits.some(e=>e.file===importer&&e.from===specifier&&e.to===expected),diagnostics)
    assert.equal(resolve(expected),join(root,sidecar),"stock TypeScript resolves the source spelling to its sidecar")
    assert.ok(readFileSync(join(root,importer),"utf8").includes('from "./other"'),"unmigrated imports remain unchanged")
    assert.deepEqual(rewriteImports(root,scope),[],"rerunning the codemod is idempotent")
    renameSync(join(root,vibe),join(root,target));rmSync(join(root,sidecar))
    restoreSpecifiers(root,edits,target)
    assert.equal(readFileSync(join(root,importer),"utf8"),files[importer],"revert restores every original spelling")
   }finally{rmSync(root,{recursive:true,force:true})}
  }
 })
})

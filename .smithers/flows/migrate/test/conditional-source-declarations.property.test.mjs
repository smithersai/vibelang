import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { compareApiIdentity, publishedEntrypoints } from "../../../../scripts/api-identity.mjs"
import { compareDeclarations } from "../lib/declarations.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-conditional-source-declarations.json", import.meta.url)))

test("conditional declaration targets quote the identity contract", () => {
 assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})

function witness({ extension = ".ts", depth = 0, defaultFirst = false, mutation = "same", flow = false, exact = false } = {}) {
 const root = mkdtempSync(join(tmpdir(), "conditional-declaration-targets-"))
 const put = (dir, file, text) => { const path = join(dir, file); mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, typeof text === "string" ? text : JSON.stringify(text)) }
 try {
  const source = "src/" + "nested/".repeat(depth) + "value" + extension
  const declaration = source.replace(/\.[^.]+$/, extension === ".mts" ? ".d.mts" : extension === ".cts" ? ".d.cts" : ".d.ts")
  const sourceTarget = "./" + source, defaultTarget = "./runtime.js"
  const nested = { types: sourceTarget, "vibelang-source": sourceTarget, default: "./.vibelang/js/" + source.replace(/\.[^.]+$/, ".js") }
  const typed = { types: sourceTarget, import: nested, require: nested }
  const conditions = exact ? corpus.exports["./entry"] : defaultFirst ? {default:defaultTarget, ...typed} : {...typed, default:defaultTarget}
  const selectedDeclaration = defaultFirst ? "runtime.d.ts" : declaration
  const manifest = target => ({ name:"conditional-source-fixture", type:"module", exports:{"./entry":target} })
  const stock = join(root, "stock")
  put(stock, "package.json", manifest(conditions))
  put(stock, source, corpus.source)
  put(stock, "runtime.d.ts", "export declare const value: boolean;")
  const options = { strict:true, noEmit:true, types:[], module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler, target:ts.ScriptTarget.ESNext, jsx:ts.JsxEmit.Preserve }
  const actual = ts.resolveModuleName("conditional-source-fixture/entry", join(stock,"consumer.ts"), options, ts.sys).resolvedModule?.resolvedFileName
  assert.equal(actual, join(stock,defaultFirst ? selectedDeclaration : source))
  assert.deepEqual(ts.getPreEmitDiagnostics(ts.createProgram([actual], options)).map(d=>d.code), [], "stock TypeScript accepts the selected original")
  const inputs = []
  for (const side of ["before","after"]) {
   const dir = join(root,side)
   put(dir,"package.json",manifest(side === "before" ? "./"+selectedDeclaration : conditions))
   for (const [file,type] of [[declaration,"number"],["runtime.d.ts","boolean"]]) {
    if (side==="after" && mutation==="missing") continue
    let text = "/** Reads the value. */\nexport declare const value: "+type+";"
    if (side==="after" && file===selectedDeclaration && mutation==="type") text=text.replace(type,"string")
    if (side==="after" && file===selectedDeclaration && mutation==="docs") text=text.replace("Reads","Retrieves")
    put(dir,file,text)
   }
   for (const file of ["package.json",declaration,"runtime.d.ts"]) {
    const path=join(dir,file)
    try { inputs.push([path,readFileSync(path,"utf8")]) } catch(e) { if(e.code!=="ENOENT") throw e }
   }
  }
  const a=join(root,"before"),b=join(root,"after")
  const result=flow ? compareDeclarations(ts,a,b) : compareApiIdentity(ts,a,b)
  assert.equal(result.comparisonComplete,mutation!=="missing",JSON.stringify(result))
  assert.equal(result.identical,mutation==="same",JSON.stringify(result))
  if(mutation==="same") {
   const selected=publishedEntrypoints(b,ts)
   assert.ok(Object.values(selected).every(file=>file===join(b,selectedDeclaration)),JSON.stringify(selected))
  }
  if(mutation==="type") assert.ok(result.typeDifferences.length,JSON.stringify(result))
  if(mutation==="docs") assert.ok(result.docDifferences.length,JSON.stringify(result))
  if(mutation==="missing") assert.ok(result.environmentDiagnostics.length,JSON.stringify(result))
  for(const[path,text]of inputs)assert.equal(readFileSync(path,"utf8"),text,"entrypoint discovery does not rewrite input manifests or declarations")
 } finally { rmSync(root,{recursive:true,force:true}) }
}
test("T3 Code conditional TypeScript source targets retain their emitted declarations",()=>witness({exact:true}))
test("migration declaration comparison uses the same conditional source surface",()=>witness({flow:true}))
test("an earlier resolvable default retains TypeScript condition order",()=>witness({defaultFirst:true}))
for(const mutation of ["type","docs","missing"])
 test("selected declaration targets keep "+mutation+" differences visible",()=>witness({mutation}))
test("property: source conditions select existing declarations without reordering",async()=>{
 await checkProperty(fc,{
  name:corpus.key, rule:corpus.quote,
  command:"node --test .smithers/flows/migrate/test/conditional-source-declarations.property.test.mjs",
  numRuns:24,
  arbitrary:fc.record({extension:fc.constantFrom(".ts",".tsx",".mts",".cts"),depth:fc.integer({min:0,max:2}),defaultFirst:fc.boolean(),mutation:fc.constantFrom("same","type","docs","missing")}),
  check:witness,
 })
})

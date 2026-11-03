import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { rewritePublishingScript } from "../lib/publishing.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const rule = "`x.vibe` emits `x.js` beside `x.d.ts` in `outDir`"
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-shared-pack-arrow-imports.json", import.meta.url), "utf8"))
function execute(text, manifest) {
 const exports = {}
 const result = ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true})
 assert.equal(result.diagnostics.length,0)
 new Function("exports",result.outputText)(exports)
 return exports.pack(manifest)
}
function source(input) {
 const suffix = input.extension === "tsx" ? "/\\.tsx?$/" : "/\\.ts$/"
 const mapper = (name, body) => input.form === "expression" ? `const ${name} = (value: string) => ${body}`
  : input.form === "block" ? `const ${name} = (value: string) => { return ${body} }`
  : `const ${name} = function(value: string) { return ${body} }`
 let text = corpus.source
 text = text.replace("DECLARATION",mapper("declaration",`value.replace("./src/", "${input.types}").replace(${suffix}, ".d.ts")`))
 text = text.replace("OUTPUT",mapper("output",`value.replace("./src/", "./dist/").replace(${suffix}, ".js")`))
 if(input.wrapped)text=text.replace(/= (\(value: string\) => [^\n]+)/g,"= ($1)")
 if(input.javascript)text=text.replace(/: string/g,"")
 return text
}
function check(input) {
 const original="./src/"+input.stem+"."+input.extension
 const sourceTarget="./src/"+input.stem+".vibe"
 const marker=input.legacy?{types:"./src/"+input.stem+".d.vibe.ts",default:sourceTarget}
  :{"vibelang-source":sourceTarget,default:"./.vibelang/js/src/"+input.stem+".js"}
 const baseline={exports:{".":original,"./asset":"./data.json","./none":null,"./existing":{import:"./keep.js",types:"./keep.d.ts"}},imports:{"#leaf":{types:original,default:original,node:original},"#asset":{default:"./asset.js"}}}
 const migrated=structuredClone(baseline)
 migrated.exports["."]=marker
 for(const key of ["types","default","node"])migrated.imports["#leaf"][key]=structuredClone(marker)
 const saved=structuredClone(migrated),text=source(input),file=input.javascript?"pack.mjs":"pack.ts"
 const rewritten=rewritePublishingScript(text,ts,file)
 assert.deepEqual(execute(rewritten.text,migrated),execute(text,baseline),"native publication JS/types/condition policy is preserved")
 assert.deepEqual(migrated,saved,"normalization leaves the workspace manifest unchanged")
 assert.equal(rewritePublishingScript(rewritten.text,ts,file).text,rewritten.text,"second setup is byte-identical")
}
test("shared pack oracle quotes Chapter 7 output paths",()=>assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md",import.meta.url),"utf8").includes(rule)))
test("opencode: shared pack's arrow mappers accept migrated nested import targets",()=>check(corpus.input))
test("property: arrow publication mappers preserve native public export/import contracts",async()=>{
 await checkProperty(fc,{name:"opencode-shared-pack-arrow-imports",rule,command:"node --test test/publishing-arrow-mappers.property.test.mjs",arbitrary:fc.record({form:fc.constantFrom("expression","block","function"),extension:fc.constantFrom("ts","tsx"),stem:fc.constantFrom("index","nested/slide-text","space name","雪"),types:fc.constantFrom("./dist/","./dist/types/"),legacy:fc.boolean(),javascript:fc.boolean(),wrapped:fc.boolean()}),check,numRuns:160,generatorVersion:1,regressions:new URL("./corpus/",import.meta.url)})
})
test("a shadowed or reassigned arrow mapper is not trusted",()=>{
 const input=corpus.input
 for(const append of ['\nfunction unrelated(output, declaration) { return output }\n','\noutput = custom; declaration = custom\n']) {
  const text=source(input)+append
  const rewritten=rewritePublishingScript(text,ts)
  // The nested imports map remains untouched when its callee is ambiguous.
  assert.ok(!rewritten.text.includes('Object.entries(conditions).map(([key, target]'))
 }
})

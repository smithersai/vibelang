import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {readFileSync} from "node:fs"
import {test} from "node:test"
import {pathToFileURL} from "node:url"
import {addSourceChildLoaders} from "../lib/source-children.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-daemon-source-child.json",import.meta.url),"utf8"))
const parse=(text,file="launcher.ts")=>ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.getScriptKindFromFileName(file))
function policy(text) {
 const source=parse(text),findings=[]
 for(const statement of source.statements) {
  if(!ts.isImportDeclaration(statement))continue
  const named=statement.importClause?.namedBindings
  if(named&&ts.isNamespaceImport(named))findings.push("no-star-import")
  if(named&&ts.isNamedImports(named)&&!statement.importClause.isTypeOnly)
   for(const item of named.elements)if(item.propertyName)findings.push("no-import-alias")
 }
 return findings
}
test("opencode daemon source-child helper reuses native Schema without introducing policy findings",()=>{
 assert.deepEqual(policy(corpus.native),[])
 const result=addSourceChildLoaders(corpus.native,ts,{file:"daemon.ts"})
 assert.deepEqual(result.refusals,[])
 assert.equal(result.usesChild,true)
 assert.deepEqual(policy(result.text),[])
 assert.equal((result.text.match(/from "effect"/g)??[]).length,1)
 assert.ok(result.text.includes('export const Lifecycle = Schema.Struct({ status: Schema.Literal("running") })'))
 assert.ok(result.text.includes("Schema.is(Schema.String)"))
 assert.ok(result.text.includes("fileURLToPath(resolved)"))
 assert.equal(addSourceChildLoaders(result.text,ts,{file:"daemon.ts"}).text,result.text)
})
test("pruning keeps authored bindings and removes only marked generated imports",()=>{
 for(const authoredUrl of [false,true]) {
  const native=(authoredUrl?'import { fileURLToPath } from "node:url"\nexport const pathname = fileURLToPath(import.meta.url)\n':"")+corpus.native
  const generated=addSourceChildLoaders(native,ts,{file:"daemon.ts"})
  assert.deepEqual(generated.refusals,[])
  const unnecessary=generated.text.replace("spawn(...__vibelangSourceChild(command, [entry]))",'spawn(...__vibelangSourceChild(command, ["entry.js"]))')
  const result=addSourceChildLoaders(unnecessary,ts,{file:"daemon.ts"})
  assert.deepEqual(result.refusals,[])
  assert.equal(result.usesChild,false)
  assert.equal(result.text.includes("VibeLang source-child binding"),false)
  assert.ok(result.text.includes('import { Schema } from "effect"'))
  assert.equal(result.text.includes('import { fileURLToPath }'),authoredUrl)
  assert.equal(result.text.includes("__vibelangSourceChild"),false)
 }
})
test("authored helper edits and binding observations remain intact",()=>{
 const generated=addSourceChildLoaders(corpus.native,ts,{file:"daemon.ts"}).text
 for(const changed of [
  generated.replace("at < values.length","at <= values.length"),
  generated+"\nexport {__vibelangSourceChild}\n",
 ]) {
  const result=addSourceChildLoaders(changed,ts,{file:"daemon.ts"})
  assert.equal(result.text,changed)
  assert.ok(result.refusals.length)
  assert.equal(result.refusals[0].line,changed.split(String.fromCharCode(10)).findIndex(line=>line.startsWith("function __vibelangSourceChild"))+1)
 }
 const observed=generated.replace("// VibeLang source-child loader arguments.","export {fileURLToPath}\n\n// VibeLang source-child loader arguments.")
 const result=addSourceChildLoaders(observed.replace("spawn(...__vibelangSourceChild(command, [entry]))",'spawn(...__vibelangSourceChild(command, ["entry.js"]))'),ts,{file:"daemon.ts"})
 assert.equal(result.usesChild,false)
 assert.ok(result.text.includes("fileURLToPath"))
 assert.ok(result.text.includes("export {fileURLToPath}"))
})
test("binding collisions and type-only imports never acquire runtime ownership",()=>{
 for(const prefix of [
  'const Schema = 1\n',
  'import type { Schema } from "effect"\n',
  'const fileURLToPath = () => 1\n',
  'import type { fileURLToPath } from "node:url"\n',
 ]) {
  const native=prefix+'import { spawn } from "node:child_process"\nspawn("node", ["entry.ts"])\n'
  const result=addSourceChildLoaders(native,ts,{file:"launcher.ts"})
  assert.ok(result.refusals.some(item=>item.reason.includes("conflicts with an authored binding")))
  assert.ok(result.text.includes(prefix.trim()))
 }
})
test("property: native import reuse survives formatting, JS and pruning",async()=>{
 await checkProperty(fc,{name:"opencode-source-child-import-policy",rule:"Generated source-child imports obey the native no-star/no-alias policy, preserve authored bindings, and prune only generated ownership.",command:"node --test .smithers/flows/migrate/test/source-child-import-policy.property.test.mjs",numRuns:160,
 arbitrary:fc.record({javascript:fc.boolean(),reuseSchema:fc.boolean(),reuseUrl:fc.boolean(),needed:fc.boolean(),semicolon:fc.boolean()}),
 check:input=>{
  const file=input.javascript?"daemon.mjs":"daemon.ts"
  let native='import { spawn } from "node:child_process"\n'+
   (input.reuseSchema?'import { Schema } from "effect"\nexport const observedSchema = Schema.String\n':"")+
   (input.reuseUrl?'import { fileURLToPath } from "node:url"\nexport const observedUrl = fileURLToPath(import.meta.url)\n':"")+
   'export function launch(command'+(input.javascript?"":": string")+', entry'+(input.javascript?"":": string")+') { return spawn(command, [entry]) }\n'
  if(input.semicolon)native=native.replaceAll('"\n','";\n')
  const generated=addSourceChildLoaders(native,ts,{file})
  assert.deepEqual(generated.refusals,[])
  assert.deepEqual(policy(generated.text),[])
  assert.equal(addSourceChildLoaders(generated.text,ts,{file}).text,generated.text)
  if(!input.needed) {
   const changed=generated.text.replace("spawn(...__vibelangSourceChild(command, [entry]))",'spawn(...__vibelangSourceChild(command, ["entry.js"]))')
   const result=addSourceChildLoaders(changed,ts,{file})
   assert.deepEqual(result.refusals,[])
   assert.equal(result.usesChild,false)
   assert.equal(result.text.includes('from "effect"'),input.reuseSchema)
   assert.equal(result.text.includes('from "node:url"'),input.reuseUrl)
  }
 }})
})

test("reused Effect root Schema is the exact native module namespace",async()=>{
 const root=await import(pathToFileURL(require.resolve("effect")).href)
 const schema=await import(pathToFileURL(require.resolve("effect/Schema")).href)
 assert.equal(root.Schema,schema)
 for(const value of ["node",1,null,undefined,{},["node"]]) assert.equal(root.Schema.is(root.Schema.String)(value),schema.is(schema.String)(value))
})
test("comments added to a generated import remain authored on cleanup",()=>{
 const generated=addSourceChildLoaders(corpus.native,ts,{file:"daemon.ts"}).text
 const changed=generated.replace("VibeLang source-child binding. */","VibeLang source-child binding. */ /* native annotation */").replace("spawn(...__vibelangSourceChild(command, [entry]))",'spawn(...__vibelangSourceChild(command, ["entry.js"]))')
 const result=addSourceChildLoaders(changed,ts,{file:"daemon.ts"})
 assert.equal(result.usesChild,false)
 assert.ok(result.text.includes("/* native annotation */"))
 assert.ok(result.text.includes("fileURLToPath"))
})

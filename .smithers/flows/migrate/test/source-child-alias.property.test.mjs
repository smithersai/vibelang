import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { addSourceChildLoaders } from "../lib/source-children.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-source-child-import-policy.json",import.meta.url)))
// The unchanged app rule: import_specifier with an alias, except inside
// a dedicated import type. Namespace imports bind a module, not an export alias.
function aliases(text) {
 const source=ts.createSourceFile("launch.ts",text,ts.ScriptTarget.Latest,true)
 return source.statements.filter(ts.isImportDeclaration).flatMap(node=>{
  const clause=node.importClause,bindings=clause?.namedBindings
  if(!clause || clause.isTypeOnly || !bindings || !ts.isNamedImports(bindings))return []
  return bindings.elements.filter(e=>e.propertyName).map(e=>[node.moduleSpecifier.text,e.propertyName.text,e.name.text])
 })
}
test("opencode: generated source-child imports obey the existing no-import-alias policy",()=>{
 assert.deepEqual(aliases(corpus.source),[])
 const fixed=addSourceChildLoaders(corpus.source,ts)
 assert.equal(fixed.usesChild,true)
 assert.deepEqual(fixed.refusals,[])
 assert.deepEqual(aliases(fixed.text),[])
 assert.equal(addSourceChildLoaders(fixed.text,ts).text,fixed.text)
})
test("setup refresh removes only the owned legacy import alias",()=>{
 assert.equal(aliases(corpus.legacy).length,1,"the original shipped helper violates the native rule")
 const fixed=addSourceChildLoaders(corpus.legacy,ts)
 assert.equal(fixed.usesChild,true)
 assert.deepEqual(fixed.refusals,[])
 assert.deepEqual(aliases(fixed.text),[])
 assert.notEqual(fixed.text,corpus.legacy)
 assert.equal(addSourceChildLoaders(fixed.text,ts).text,fixed.text)
})
test("property: generated helpers preserve authored import policy across bindings and refreshes",()=>{
 fc.assert(fc.property(fc.boolean(),fc.boolean(),fc.integer({min:0,max:4}),fc.constantFrom("launch.ts","launch.mjs"),
  (authoredAlias,namespace,collisions,file)=>{
   const head=namespace?'import * as child from "node:child_process";':'import { spawn'+(authoredAlias?' as launchChild':'')+' } from "node:child_process";'
   const call=namespace?'child.spawn':authoredAlias?'launchChild':'spawn'
   const prefix=Array.from({length:collisions},(_,i)=>'const __vibelangSourceChild'+(i?i+1:'')+' = '+i+'; const __vibelangNodeURL'+(i?i+1:'')+' = '+i+';').join("\n")
   const input=head+"\n"+prefix+'\nexport const launch = (command'+(file.endsWith(".ts")?': string':'')+') => '+call+'(command, ["entry.ts"]);'
   const result=addSourceChildLoaders(input,ts,{file})
   assert.deepEqual(result.refusals,[])
   assert.deepEqual(aliases(result.text),aliases(input))
   assert.equal(addSourceChildLoaders(result.text,ts,{file}).text,result.text)
  }),{seed:830051,numRuns:160})
})
test("mutable argv remains refused without an injected import",()=>{
 const source='import { spawn } from "node:child_process"; let args=["entry.ts"]; export const launch=(command: string)=>spawn(command,args)'
 const result=addSourceChildLoaders(source,ts)
 assert.equal(result.text,source)
 assert.equal(result.usesChild,false)
 assert.ok(result.refusals.some(r=>/shared or mutable/.test(r.reason)))
})
test("legacy helper imports observed by manual exports or shorthands remain unchanged",()=>{
 for(const use of ['export { __vibelangFileURLToPath };','export const manual = { __vibelangFileURLToPath };','export const manual = __vibelangFileURLToPath;']) {
  const source=corpus.legacy+"\n"+use
  const result=addSourceChildLoaders(source,ts)
  assert.equal(result.text,source,"manual function binding must not become a namespace")
  assert.ok(result.refusals.some(r=>/manual references/.test(r.reason)))
 }
})
test("legacy refresh preserves authored aliases and handles generated collision suffixes",()=>{
 fc.assert(fc.property(fc.integer({min:0,max:20}),fc.boolean(),(suffix,authored)=>{
  const old="__vibelangFileURLToPath",name=old+(suffix?String(suffix+1):"")
  const source=corpus.legacy.replaceAll(old,name)+(authored?'\nimport {fileURLToPath as __vibelangFileURLToPath999} from "node:url"; export const manual = __vibelangFileURLToPath999;':"")
  const result=addSourceChildLoaders(source,ts)
  assert.deepEqual(result.refusals,[])
  const expected=authored?[["node:url","fileURLToPath","__vibelangFileURLToPath999"]]:[]
  assert.deepEqual(aliases(result.text),expected)
  assert.equal(addSourceChildLoaders(result.text,ts).text,result.text)
 }),{seed:830052,numRuns:80})
})

test("legacy refresh retains generated-file and CommonJS safety boundaries",()=>{
 const generated="// @generated; do not edit\n"+corpus.legacy
 const a=addSourceChildLoaders(generated,ts)
 assert.equal(a.text,generated)
 assert.ok(a.refusals.some(r=>/generated child-process/.test(r.reason)))
 const b=addSourceChildLoaders(corpus.legacy,ts,{file:"launch.cjs",type:"commonjs"})
 assert.equal(b.text,corpus.legacy)
 assert.ok(b.refusals.some(r=>/CommonJS/.test(r.reason)))
})

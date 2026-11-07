// The emit diagnostic below is a recorded snapshot input. This small source
// does not itself trigger a native declaration-nameability diagnostic.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-asymmetric-declaration-source.json",import.meta.url),"utf8"))
const put = (file,text) => {mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}

function fixture(check,{name="value",type="string",doc="The value.",published=false}={}) {
  const root=mkdtempSync(join(tmpdir(),"asymmetric-source-")),pkg=join(root,"pkg")
  const original=`/** ${doc} */\nexport const ${name} = { text: ${type === "string" ? '"ok"' : "42"} };\n`
  const header=`/** ${doc} */\nexport declare const ${name}: { text: ${type} };\n`
  try {
    put(join(pkg,"package.json"),JSON.stringify({name:"asymmetric-source",private:!published,type:"module",...(published?{exports:{".":{types:"./src/index.ts"}}}:{})}))
    put(join(pkg,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,types:[],target:"ESNext",module:"NodeNext",moduleResolution:"NodeNext",allowImportingTsExtensions:true,noEmit:true,declaration:true},include:["src"]}))
    const snapshot=(name,present,{source=original,declaration=header}={})=>{
      const dir=join(root,name)
      mkdirSync(dir,{recursive:true})
      put(join(pkg,"src/index.ts"),source)
      if(present)put(join(dir,"src/index.d.ts"),declaration)
      recordDeclarationSurface(ts,dir,pkg,[{tsconfig:"tsconfig.json",prefix:"."}],undefined,{
        emitDiagnostics:present?[]:[{category:"error",code:"TS7056",file:"pkg/src/index.ts",line:2,column:14,message:"too long",notes:[]}],emitRoot:root
      })
      return dir
    }
    const compare=(a,b)=>compareDeclarations(ts,a,b,{canonical:true,includePrivate:true})
    return check({snapshot,compare,original,header})
  } finally {rmSync(root,{recursive:true,force:true})}
}

test("a saved source is checked against its peer's actual emitted declaration in either direction",()=>fixture(({snapshot,compare})=>{
  const absent=snapshot("absent",false),present=snapshot("present",true)
  for(const [a,b] of [[absent,present],[present,absent]]) {
    const result=compare(a,b)
    assert.equal(result.comparisonComplete,true,JSON.stringify(result))
    assert.equal(result.identical,true,JSON.stringify(result))
  }
}))

test("a changed emitted field type is rejected against the saved source",()=>fixture(({snapshot,compare,header})=>{
  const result=compare(snapshot("absent",false),snapshot("changed",true,{declaration:header.replace("text: string","text: number")}))
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,false)
  assert.ok(result.typeDifferences.length,JSON.stringify(result))
}))

test("a body error in the saved source keeps the comparison incomplete",()=>fixture(({snapshot,compare,original})=>{
  const result=compare(snapshot("broken",false,{source:original+'const bad: number = "wrong";\n'}),snapshot("present",true))
  assert.equal(result.comparisonComplete,false)
  assert.equal(result.identical,false)
  assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&/TS2322/.test(d.diagnostic)),JSON.stringify(result))
}))

test("a changed declaration's documentation is still rejected",()=>fixture(({snapshot,compare,header})=>{
  const result=compare(snapshot("absent",false),snapshot("changed",true,{declaration:header.replace("The value.","Different prose.")}))
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,false)
  assert.ok(result.docDifferences.length,JSON.stringify(result))
}))

test("property: an emitted counterpart must match the saved source's names, types and docs",()=>{
  assert.ok(readFileSync(new URL("../../../../docs/design/vips/0027-declaration-output.md",import.meta.url),"utf8").includes(corpus.rule))
  fc.assert(fc.property(fc.constantFrom("value","item","result"),fc.constantFrom("string","number"),fc.constantFrom("The value.","A retained record."),(name,type,doc)=>fixture(({snapshot,compare,header})=>{
    const absent=snapshot("absent",false),present=snapshot("present",true)
    assert.equal(compare(absent,present).identical,true)
    const changed=snapshot("changed",true,{declaration:header.replace("text: "+type,"text: "+(type==="string"?"number":"string"))})
    const result=compare(absent,changed)
    assert.equal(result.comparisonComplete,true,JSON.stringify(result))
    assert.equal(result.identical,false)
    assert.ok(result.typeDifferences.length)
  },{name,type,doc})),{numRuns:12,seed:277056})
})

test("public entry points compare the actual saved source and declaration",()=>fixture(({snapshot,compare})=>{
  const absent=snapshot("absent",false),present=snapshot("present",true)
  for(const [a,b] of [[absent,present],[present,absent]]) {
    const result=compare(a,b)
    assert.equal(result.comparisonComplete,true,JSON.stringify(result))
    assert.equal(result.identical,true,JSON.stringify(result))
  }
},{published:true}))

test("missing source evidence keeps one-sided declaration availability incomplete",()=>fixture(({snapshot,compare})=>{
  const absent=snapshot("absent",false),present=snapshot("present",true)
  const metadata=join(absent,"public-surface.json"),surface=JSON.parse(readFileSync(metadata,"utf8"))
  delete surface.apiMetadata.absentSources
  writeFileSync(metadata,JSON.stringify(surface))
  const result=compare(absent,present)
  assert.equal(result.comparisonComplete,false)
  assert.equal(result.identical,false)
  assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&/one-sided absence/.test(d.diagnostic)),JSON.stringify(result))
}))

test("an unresolved import in the saved source remains a blocking error",()=>fixture(({snapshot,compare})=>{
  const source='import { missing } from "./missing.js";\nexport const value = missing;\n'
  const result=compare(snapshot("absent",false,{source}),snapshot("present",true))
  assert.equal(result.comparisonComplete,false)
  assert.equal(result.identical,false)
  assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&/TS2307/.test(d.diagnostic)),JSON.stringify(result))
}))

test("success, error and requirement types cannot change across the boundary",()=>fixture(({snapshot,compare})=>{
  const shape='{ readonly success: number; readonly error: "LoadFailed" | "Persistence"; readonly requirement: "Store" }'
  const source='export const value = null as unknown as '+shape+';\n'
  const declaration='export declare const value: '+shape+';\n'
  const absent=snapshot("absent",false,{source})
  const same=compare(absent,snapshot("same",true,{declaration}))
  assert.equal(same.comparisonComplete,true,JSON.stringify(same))
  assert.equal(same.identical,true,JSON.stringify(same))
  for(const [index,changed] of [
    declaration.replace("success: number","success: string"),
    declaration.replace('"LoadFailed" | "Persistence"',"never"),
    declaration.replace('"Store"',"never"),
    declaration.replace("const value","const renamed")
  ].entries()) {
    const result=compare(absent,snapshot("changed"+index,true,{declaration:changed}))
    assert.equal(result.comparisonComplete,true,JSON.stringify(result))
    assert.equal(result.identical,false)
    assert.ok(result.typeDifferences.length||result.nameDifferences.length,JSON.stringify(result))
  }
}))

import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const options = { compilerOptions: { lib: ["lib.es5.d.ts"] } }
function fixture(before, after, run) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-scale-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) for (const [name, text] of Object.entries(files)) {
      const file = join(root, side, name)
      mkdirSync(join(file, ".."), { recursive: true })
      writeFileSync(file, text)
    }
    return run(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const chain = (depth, leaf) => Array.from({ length: depth }, (_, i) =>
  `interface N${i} { next: N${i + 1} }`).join("\n") +
  `\ninterface N${depth} {\n/** ${leaf} */\nvalue: string\n}\ntype Root = N0;\nexport { Root };`

test("deep exported object chains finish and retain terminal documentation", () => {
  const before = { "index.d.ts": chain(12000, "Terminal documentation") }
  const after = { "index.d.ts": chain(12000, "Changed documentation") }
  fixture(before, after, (a, b) => {
    const same = compareApiIdentity(ts, a, a, options)
    assert.equal(same.identical, true, JSON.stringify(same))
    const changed = compareApiIdentity(ts, a, b, options)
    assert.equal(changed.comparisonComplete, true, JSON.stringify(changed))
    assert.equal(changed.identical, false)
    assert.ok(changed.docDifferences.some(d => d.export.endsWith(".value") &&
      d.before === "Terminal documentation" && d.after === "Changed documentation"))
  })
})

test("many exports sharing a deep documented graph do not repeat the documentation walk", () => {
  const text = chain(12000, "Terminal documentation")
    .replace("type Root = N0;\nexport { Root };", "export type Root = N0;")
  fixture({ "index.d.ts": text }, { "index.d.ts": text }, (a, b) => {
    const result = compareApiIdentity(ts, a, b, options)
    assert.equal(result.identical, true, JSON.stringify(result))
  })
})

test("deep error-type walks terminate without hiding a missing exported type", () => {
  for (const used of [false, true]) {
    const files = {
      "index.d.ts": 'import "foreign";\n' + chain(10000, "Terminal").replace("value: string",
        used ? 'value: import("foreign").Broken' : "value: string"),
      "node_modules/foreign/package.json": '{"types":"index.d.ts"}',
      "node_modules/foreign/index.d.ts": "export type Broken = Missing;",
    }
    fixture(files, files, a => {
      const result = compareApiIdentity(ts, a, a, options)
      assert.equal(result.failure, undefined, JSON.stringify(result))
      assert.equal(result.comparisonComplete, !used, JSON.stringify(result))
      assert.equal(result.identical, !used)
      assert.deepEqual(result.typeDifferences, [])
    })
  }
})

const verdict = result => ({
  identical: result.identical, comparisonComplete: result.comparisonComplete,
  nameDifferences: result.nameDifferences,
  typeDifferences: result.typeDifferences.map(({ probe, ...difference }) => difference),
  docDifferences: result.docDifferences,
  environmentDiagnostics: result.environmentDiagnostics,
})
test("property: generated large package verdicts equal small-batch verdicts", async () => {
  await checkProperty(fc, {
    name: "api-identity-large-batch-invariance",
    rule: "Will: exported names, strict bidirectional types and docs are identical regardless of batch size; identical trees report identical",
    command: "node --test scripts/api-identity-scale.test.mjs",
    numRuns: 4,
    arbitrary: fc.record({ modules: fc.integer({ min: 9, max: 12 }), exports: fc.integer({ min: 8, max: 12 }),
      mutation: fc.constantFrom("none", "type", "doc", "name"), value: fc.integer({ min: 1, max: 1000 }) }),
    check: ({ modules, exports, mutation, value }) => {
      const before = {}, after = {}
      for (let m = 0; m < modules; m++) {
        const lines = Array.from({ length: exports }, (_, i) =>
          `/** Export ${m} ${i} */\nexport type X${i}<T = string> = { value: ${value}; item: T };\n`)
        before[`m${m}.d.ts`] = lines.join("")
        if (m === modules - 1) {
          if (mutation === "type") lines[exports - 1] = lines[exports - 1].replace(`value: ${value}`, `value: ${value + 1}`)
          if (mutation === "doc") lines[exports - 1] = lines[exports - 1].replace("Export", "Changed")
          if (mutation === "name") lines[exports - 1] = lines[exports - 1].replace(`X${exports - 1}<`, "Renamed<")
        }
        after[`m${m}.d.ts`] = lines.join("")
      }
      fixture(before, after, (a, b) => {
        const whole = compareApiIdentity(ts, a, b, { ...options, entryBatchSize: 10000, probeBatchSize: 10000, diagnosticBatchSize: 10000 })
        const small = compareApiIdentity(ts, a, b, { ...options, entryBatchSize: 2, probeBatchSize: 7, diagnosticBatchSize: 2 })
        assert.equal(whole.comparisonComplete, true, JSON.stringify(whole))
        assert.equal(whole.identical, mutation === "none")
        assert.deepEqual(verdict(small), verdict(whole))
        assert.equal(compareApiIdentity(ts, a, a, { ...options, entryBatchSize: 2, probeBatchSize: 7, diagnosticBatchSize: 2 }).identical, true)
      })
    },
  })
})

test("independent generic entry points fit a bounded heap", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-large-entry-batches.json", import.meta.url)))
  const files = {}
  for (let i = 0; i < corpus.moduleCount; i++) files[`m${i}.d.ts`] =
    `type Tuple<N extends number, T extends unknown[] = []> = T["length"] extends N ? T : Tuple<N, [...T, ${i}]>;
type Assert<T extends true> = T;
type Force = Assert<Tuple<${corpus.tupleDepth}>["length"] extends ${corpus.tupleDepth} ? true : false>;
/** Tuple export ${i} */
export type X = { value: Tuple<${corpus.tupleDepth}>; tag: ${i} };`
  fixture(files, files, (a, b) => {
    const source = `import { readFileSync } from "node:fs";
import { compareApiIdentity, loadTypeScript } from ${JSON.stringify(new URL("./api-identity.mjs", import.meta.url).href)};
const [a, b] = JSON.parse(readFileSync(0, "utf8"));
const result = compareApiIdentity(loadTypeScript(), a, b, { compilerOptions: { lib: ["lib.es5.d.ts"] } });
console.log(JSON.stringify(result));
process.exitCode = result.identical ? 0 : result.comparisonComplete ? 1 : 2;`
    const child = spawnSync(process.execPath, [`--max-old-space-size=${corpus.heapLimitMiB}`, "--input-type=module", "--eval", source], {
      input: JSON.stringify([a, b]), encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024,
    })
    assert.equal(child.status, 0, child.stdout + child.stderr)
    assert.equal(child.signal, null)
    const result = JSON.parse(child.stdout)
    assert.equal(result.comparisonComplete, true)
    assert.equal(result.identical, true)
  })
})

test("input checker state is released before validating generic bridges", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-probe-checker-lifetime.json", import.meta.url)))
  const text = `type Tuple<V, N extends number, T extends unknown[] = []> = T["length"] extends N ? T : Tuple<V, N, [...T, V]>;
type Assert<T extends true> = T;
` + Array.from({ length: corpus.familyCount }, (_, i) =>
    `type Force${i} = Assert<Tuple<${i}, ${corpus.tupleDepth}>["length"] extends ${corpus.tupleDepth} ? true : false>;`).join("\n") +
    "\nexport type Api<T = string> = { item: T };"
  fixture({ "index.d.ts": text }, { "index.d.ts": text }, (a, b) => {
    const source = `import { readFileSync } from "node:fs";
import { compareApiIdentity, loadTypeScript } from ${JSON.stringify(new URL("./api-identity.mjs", import.meta.url).href)};
const [a, b] = JSON.parse(readFileSync(0, "utf8"));
const result = compareApiIdentity(loadTypeScript(), a, b, { compilerOptions: { lib: ["lib.es5.d.ts"] } });
console.log(JSON.stringify(result));
process.exitCode = result.identical ? 0 : result.comparisonComplete ? 1 : 2;`
    const child = spawnSync(process.execPath, [`--max-old-space-size=${corpus.heapLimitMiB}`, "--input-type=module", "--eval", source], {
      input: JSON.stringify([a, b]), encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024,
    })
    assert.equal(child.status, 0, child.stdout + child.stderr)
    assert.equal(child.signal, null)
    const result = JSON.parse(child.stdout)
    assert.equal(result.comparisonComplete, true)
    assert.equal(result.identical, true)
  })
})

test("dependency diagnostic batches release unrelated generic instantiations", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-dependency-diagnostics.json", import.meta.url)))
  const files = { "index.d.ts": 'import "foreign"; export interface Api<T = string> { value: T }',
    "node_modules/foreign/package.json": '{"name":"foreign","types":"index.d.ts"}',
    "node_modules/foreign/index.d.ts": Array.from({length:corpus.moduleCount}, (_,i) => `import "./m${i}.js";`).join("\n") }
  for (let i=0; i<corpus.moduleCount; i++) files[`node_modules/foreign/m${i}.d.ts`] =
    `type Tuple<N extends number, T extends unknown[] = []> = T["length"] extends N ? T : Tuple<N, [...T, ${i}]>;
type Assert<T extends true> = T;
type Force = Assert<Tuple<${corpus.tupleDepth}>["length"] extends ${corpus.tupleDepth} ? true : false>;
export type X = ${i};
` + (i===corpus.moduleCount-1 ? "type Bad = Assert<false>;" : "")
  fixture(files, files, (a,b) => {
    const source = `import {readFileSync} from "node:fs";
import {compareApiIdentity,loadTypeScript} from ${JSON.stringify(new URL("./api-identity.mjs",import.meta.url).href)};
const [a,b] = JSON.parse(readFileSync(0,"utf8"));
const result=compareApiIdentity(loadTypeScript(),a,b,{compilerOptions:{lib:["lib.es5.d.ts"]}});
console.log(JSON.stringify(result));process.exitCode=result.identical?0:2;`
    const child=spawnSync(process.execPath,[`--max-old-space-size=${corpus.heapLimitMiB}`,"--input-type=module","--eval",source],{
      input:JSON.stringify([a,b]),encoding:"utf8",timeout:180000,maxBuffer:1024*1024})
    assert.equal(child.status,0,child.stdout+child.stderr)
    assert.equal(child.signal,null)
    const result=JSON.parse(child.stdout)
    assert.equal(result.comparisonComplete,true)
    assert.ok(result.environmentDiagnostics.some(d=>!d.blocking && /TS2344/.test(d.diagnostic)),
      "All dependency diagnostics, including the last batch, remain visible")
  })
})

test("an invalid entry group keeps its diagnostic when later checker work would crash", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-invalid-entry-prefix.json", import.meta.url)))
  const files = Object.fromEntries(Array.from({length:corpus.moduleCount},(_,i)=>[`m0${i}.d.ts`,
    i===0 ? corpus.invalidSource : corpus.laterSource]))
  fixture(files,files,(a,b)=>{
    const compiler={...ts,createProgram(...args) {
      const roots=Array.isArray(args[0])?args[0]:args[0].rootNames
      if(roots.some(file=>file.endsWith("m08.d.ts")))throw new RangeError("later checker stack exhausted")
      return ts.createProgram(...args)
    }}
    const result=compareApiIdentity(compiler,a,b,options)
    assert.equal(result.identical,false)
    assert.equal(result.comparisonComplete,false)
    assert.equal(result.failure,undefined,JSON.stringify(result))
    assert.deepEqual(result.typeDifferences,[])
    assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&/TS2304.*Missing/.test(d.diagnostic)),JSON.stringify(result))
  })
})

test("property: invalid prefixes stay invalid and valid mismatches still inspect later entries", async () => {
  await checkProperty(fc,{
    name:"api-identity-invalid-entry-prefix",
    rule:"Will: a crash is an explicit invalid result, never identical; only complete comparisons establish names, bidirectional types and docs",
    command:"node --test scripts/api-identity-scale.test.mjs",
    numRuns:6,
    arbitrary:fc.record({modules:fc.integer({min:4,max:9}),entryBatchSize:fc.integer({min:1,max:3}),broken:fc.boolean()}),
    check:({modules,entryBatchSize,broken})=>{
      const before={},after={}
      for(let i=0;i<modules;i++){
        const key=`m0${i}.d.ts`
        before[key]=after[key]="/** Original */ export type X = string;"
      }
      const last=`m0${modules-1}.d.ts`
      if(broken)before["m00.d.ts"]=after["m00.d.ts"]="export type Broken = Missing;"
      else after["m00.d.ts"]=after["m00.d.ts"].replace("string","number")
      after[last]=after[last].replace("Original","Changed")
      fixture(before,after,(a,b)=>{
        const result=compareApiIdentity(ts,a,b,{...options,entryBatchSize})
        assert.equal(result.identical,false)
        assert.equal(result.comparisonComplete,!broken)
        if(broken){
          assert.deepEqual(result.typeDifferences,[])
          assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&/TS2304/.test(d.diagnostic)))
        }else{
          assert.ok(result.typeDifferences.some(d=>d.entrypoint==="m00.d.ts"))
          assert.ok(result.docDifferences.some(d=>d.entrypoint===last),"A real API mismatch must not skip later docs")
        }
      })
    }
  })
})

test("project unused-code checks do not reject generated identity probes", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-project-unused-probes.json", import.meta.url)))
  for(const text of ["export {};",corpus.declaration,"export declare const value: number;"]){
    fixture({"index.d.ts":text},{"index.d.ts":text},(a,b)=>{
      const settings={...options.compilerOptions,noUnusedLocals:true,noUnusedParameters:true}
      const original=ts.createProgram([join(a,"index.d.ts")],{...settings,target:ts.ScriptTarget.ESNext,
        module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,noEmit:true,strict:true,types:[]})
      assert.deepEqual(ts.getPreEmitDiagnostics(original),[],"Stock tsc 5.9.3 accepts the original declaration")
      const result=compareApiIdentity(ts,a,b,{compilerOptions:settings})
      assert.equal(result.identical,true,JSON.stringify(result))
      assert.equal(result.comparisonComplete,true)
    })
  }
})

test("real unused input locals and parameters remain invalid", () => {
  for(const text of ["const unused = 1; export const value = 1;","export function value(unused: string) { return 1 }"]){
    fixture({"index.ts":text},{"index.ts":text},(a,b)=>{
      const result=compareApiIdentity(ts,a,b,{compilerOptions:{...options.compilerOptions,noUnusedLocals:true,noUnusedParameters:true},
        beforeEntrypoints:{".":join(a,"index.ts")},afterEntrypoints:{".":join(b,"index.ts")}})
      assert.equal(result.identical,false)
      assert.equal(result.comparisonComplete,false)
      assert.deepEqual(result.typeDifferences,[])
      assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&/TS6133/.test(d.diagnostic)&&d.file?.endsWith("index.ts")),JSON.stringify(result))
    })
  }
})

test("property: project unused flags preserve declaration identity and real differences", async () => {
  await checkProperty(fc,{
    name:"api-identity-project-unused-probes",
    rule:"Will: match TypeScript; generated checker implementation cannot make a valid original declaration invalid, and real input diagnostics stay visible",
    command:"node --test scripts/api-identity-scale.test.mjs",
    numRuns:8,
    arbitrary:fc.record({locals:fc.boolean(),parameters:fc.boolean(),count:fc.integer({min:1,max:12}),mutated:fc.boolean()}),
    check:({locals,parameters,count,mutated})=>{
      const before=Array.from({length:count},(_,i)=>`export interface X${i}<T = string> { value: T; tag: ${i} }`).join("\n")
      const after=mutated?before.replace(`tag: ${count-1} }`,`tag: ${count} }`):before
      fixture({"index.d.ts":before},{"index.d.ts":after},(a,b)=>{
        const result=compareApiIdentity(ts,a,b,{compilerOptions:{...options.compilerOptions,noUnusedLocals:locals,noUnusedParameters:parameters},probeBatchSize:2})
        assert.equal(result.comparisonComplete,true,JSON.stringify(result))
        assert.equal(result.identical,!mutated)
        if(mutated)assert.ok(result.typeDifferences.some(d=>d.export===`X${count-1}`))
      })
    }
  })
})

test("a project noCheck setting cannot establish false API identity", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-project-no-check.json", import.meta.url)))
  fixture({"index.d.ts":corpus.before},{"index.d.ts":corpus.after},(a,b)=>{
    const result=compareApiIdentity(ts,a,b,{compilerOptions:{...options.compilerOptions,noCheck:true}})
    assert.equal(result.identical,false,JSON.stringify(result))
    assert.equal(result.comparisonComplete,true)
    assert.ok(result.typeDifferences.some(d=>d.export==="X"&&!d.mutuallyAssignable))
  })
  fixture({"index.d.ts":"export type X = Missing;"},{"index.d.ts":"export type X = Missing;"},(a,b)=>{
    const result=compareApiIdentity(ts,a,b,{compilerOptions:{...options.compilerOptions,noCheck:true}})
    assert.equal(result.identical,false,JSON.stringify(result))
    assert.equal(result.comparisonComplete,false)
    assert.deepEqual(result.typeDifferences,[])
    assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&/TS2304/.test(d.diagnostic)))
  })
})

test("property: project noCheck cannot bypass bidirectional identity", async () => {
  await checkProperty(fc,{
    name:"api-identity-project-no-check",
    rule:"Will: each export type must be identical to tsc in both directions; a compiler flag cannot turn an unchecked assertion into proof",
    command:"node --test scripts/api-identity-scale.test.mjs",
    numRuns:8,
    arbitrary:fc.record({noCheck:fc.boolean(),mutated:fc.boolean(),value:fc.integer({min:1,max:999})}),
    check:({noCheck,mutated,value})=>{
      fixture({"index.d.ts":`export interface X<T = string> { item: T; value: ${value} }`},
        {"index.d.ts":`export interface X<T = string> { item: T; value: ${mutated?value+1:value} }`},(a,b)=>{
        const result=compareApiIdentity(ts,a,b,{compilerOptions:{...options.compilerOptions,noCheck,skipLibCheck:true,strict:false,strictFunctionTypes:false,strictNullChecks:false}})
        assert.equal(result.comparisonComplete,true,JSON.stringify(result))
        assert.equal(result.identical,!mutated)
        if(mutated)assert.ok(result.typeDifferences.some(d=>d.export==="X"))
      })
    }
  })
})

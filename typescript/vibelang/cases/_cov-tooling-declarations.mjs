import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"

export function nativeContract(mode) {
  assert.equal(ts.version, "5.9.3")
  const failures = []
  const check = (key, action) => { try { action() } catch (error) { failures.push({ key, message: error.message }) } }
  const fixture = action => {
    const dir = mkdtempSync(join(tmpdir(), "cov-tooling-native-"))
    const put = (name, value) => { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value)) }
    try {
      put("package.json", '{"type":"module"}')
      mkdirSync(join(dir, "node_modules"))
      symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
      symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
      const invoke = (...args) => {
        const r = spawnSync(process.env.VIBELANG_BINARY, args, { cwd: dir, encoding: "utf8", timeout: 30000 })
        assert.ifError(r.error); assert.equal(r.signal, null); return { ...r, text: r.stdout + r.stderr }
      }
      const options = { target: "ES2022", module: "NodeNext", strict: true, types: [], skipLibCheck: true, jsx: "preserve", outDir: "out" }
      const config = extra => put("tsconfig.json", { compilerOptions: options, vibe: { effectGlobals: false, effectModules: false }, ...extra })
      action({ dir, put, invoke, config, options })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  if (mode === "consumer") {
    for (const extension of [".vibe", ".vibex"]) for (const native of [".ts", ".tsx"]) for (const rewrite of [undefined, false, true]) fixture(({dir, put, invoke, config, options}) => {
      put("producer" + extension, "export const value = 42 as const")
      put("producer.d" + extension + ".ts", "export declare const value: 42;")
      put("consumer" + native, 'import { value } from "./producer' + extension + '"; export const answer: 42 = value;')
      Object.assign(options, { allowArbitraryExtensions: true, ...(rewrite === undefined ? {} : { rewriteRelativeImportExtensions: rewrite }) })
      config({ files: ["consumer" + native, "producer" + extension] })
      // Stock checks the same native consumer using its explicit custom-extension sidecar.
      const stockOptions = { ...ts.convertCompilerOptionsFromJson(options, dir).options, noEmit: true }
      const stock = ts.createProgram([join(dir, "consumer" + native)], stockOptions)
      assert.deepEqual(ts.getPreEmitDiagnostics(stock).map(d => d.code), [])
      const fork = invoke("-p", ".", "--pretty", "false")
      check([extension, native, rewrite].join("/"), () => {
        assert.equal(fork.status, 0, fork.text)
        const js = readFileSync(join(dir, "out/consumer" + (native === ".tsx" ? ".jsx" : ".js")), "utf8")
        assert.ok(js.includes("./producer" + (extension === ".vibex" ? ".jsx" : ".js")), js)
      })
    })
  } else if (mode === "native-errors") {
    for (const enabled of [false, true]) fixture(({put, invoke, config, options}) => {
      Object.assign(options, { noEmit: true })
      put("native.ts", 'import { Effect } from "effect"; export function legal(): Effect.Effect<number> { throw new Error("native") }; export const made = new Function("return 1");')
      put("embedded.vibe", 'export const n: number = "wrong";')
      config({ files: ["native.ts", "embedded.vibe"], vibe: { effectGlobals: enabled, effectModules: enabled } })
      const fork = invoke("-p", ".", "--pretty", "false")
      check("native ownership/" + enabled, () => {
        assert.notEqual(fork.status, 0)
        assert.deepEqual([...fork.text.matchAll(/\b(?:error|warning) ((?:TS|EK)\d+):/g)].map(m => m[1]), ["TS2322"], fork.text)
        assert.match(fork.text, /embedded\.vibe/)
      })
    })
  } else if (mode === "declaration-spelling") {
    for (const suffix of [".vibe", ".vibex"]) for (const rewrite of [false,true]) for (const allow of [false,true]) fixture(({dir,put,invoke,config,options}) => {
      Object.assign(options, { declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: allow, rewriteRelativeImportExtensions: rewrite })
      put("producer" + suffix, "export interface Value { n: number }; export const value: Value = { n: 1 };")
      put("main" + suffix, 'export { value } from "./producer' + suffix + '";')
      config({ files: ["main" + suffix] })
      const fork = invoke("-p", ".", "--pretty", "false")
      // Native oracle uses the corresponding ts/tsx extension and otherwise identical options.
      const twin = suffix === ".vibe" ? ".ts" : ".tsx"
      put("producer" + twin, "export interface Value { n: number }; export const value: Value = { n: 1 };")
      put("main" + twin, 'export { value } from "./producer' + twin + '";')
      const nativeOptions = { ...ts.convertCompilerOptionsFromJson(options, dir).options, outDir: join(dir,"stock") }
      const native = ts.createProgram([join(dir,"main"+twin)], nativeOptions)
      native.emit()
      const expected = readFileSync(join(dir,"stock/main.d.ts"),"utf8").replaceAll("./producer"+twin, "./producer"+suffix)
      check([suffix,rewrite,allow].join("/"), () => {
        assert.equal(readFileSync(join(dir,"out/main.d.ts"),"utf8"), expected, fork.text)
        const adjacent = join(dir,"main.d"+suffix+".ts")
        assert.ok(existsSync(adjacent), "missing compatibility declaration")
        assert.ok(readFileSync(adjacent,"utf8").includes("./producer"+suffix), "adjacent compatibility output must keep the source suffix")
      })
    })
  } else if (mode === "retired-option") {
    for (const value of [".js", ".ts", "extensionless", null, false, 7]) for (const nested of [false,true]) fixture(({put,invoke,config,options}) => {
      Object.assign(options,{ noEmit: true })
      put("main.vibe","export const value = 1;")
      config({ files: ["main.vibe"], ...(nested ? { compilerOptions: { ...options, vibelang: { declarationImportStyle: value } } } : { vibelang: { declarationImportStyle: value } }) })
      const r=invoke("-p",".","--pretty","false")
      check(JSON.stringify({nested,value}),()=>{ assert.equal(r.status,0,r.text); assert.match(r.text,/warning EK\d+.*declarationImportStyle/,r.text) })
    })
  } else if (mode === "sidecar-config") {
    for (const value of [false,true,null,[],["types"],42,{}]) fixture(({put,invoke,config,options})=>{
      Object.assign(options,{noEmit:true}); put("main.vibe","export const value = 1;")
      config({ files:["main.vibe"], vibe: {effectGlobals:false,effectModules:false,sidecarDir:value} })
      const r=invoke("-p",".","--pretty","false")
      check(JSON.stringify(value),()=>{assert.notEqual(r.status,0,r.text);assert.match(r.text,/sidecarDir/,r.text)})
    })
    fixture(({put,invoke,config,options})=>{
      Object.assign(options,{noEmit:true});put("main.vibe","export const value = 1;");config({files:["main.vibe"]})
      const r=invoke("--sidecarDir","types","-p",".","--pretty","false")
      check("no new CLI flag",()=>{assert.notEqual(r.status,0);assert.match(r.text,/TS5023/)})
    })
  } else if (mode === "async-contracts") { fixture(({dir,put,invoke,config,options})=>{
    Object.assign(options,{declaration:true,emitDeclarationOnly:true})
    put("main.vibe","/** @rethrows f */\nexport async function each(f: () => void) { f() }\n")
    config({files:["main.vibe"]});const r=invoke("-p",".","--pretty","false");assert.equal(r.status,0,r.text)
    const text=readFileSync(join(dir,"out/main.d.ts"),"utf8")
    assert.match(text,/@throws \{never\}/);assert.match(text,/@throws \{unknown\}/,"callback admission survives erasing async");assert.doesNotMatch(text,/@rethrows/)
    const native=ts.createProgram([join(dir,"out/main.d.ts")],{noEmit:true,types:[],skipLibCheck:true})
    assert.deepEqual(ts.getPreEmitDiagnostics(native).map(d=>d.code),[])
    })
  } else if (mode === "matcher-declarations") {
    for(const suffix of [".vibe",".vibex"]) fixture(({dir,put,invoke,config,options})=>{
      Object.assign(options,{declaration:true,emitDeclarationOnly:true});put("main"+suffix,'export error Missing { id: string }\nexport schema error Invalid { message: string }\n')
      config({files:["main"+suffix]});const r=invoke("-p",".","--pretty","false");assert.equal(r.status,0,r.text)
      for(const entry of ["out/main.d.ts","main.d"+suffix+".ts"]) check(suffix+"/"+entry,()=>{
        const text=readFileSync(join(dir,entry),"utf8")
        assert.ok(text.startsWith('/// <reference types="vibelang-runtime" />'),"runtime Symbol augmentation reference")
        assert.equal((text.match(/static \[Symbol\.customMatcher\]/g)||[]).length,2,"both class kinds retain their matcher")
        const program=ts.createProgram([join(dir,entry)],{noEmit:true,types:[],strict:true,module:ts.ModuleKind.NodeNext,target:ts.ScriptTarget.ES2022})
        assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),[])
      })
    })
  } else if (mode === "foreign-gate") {
    for(const bound of ["unknown","any","TopUnknown","TopAny"]) for(const origin of ["body","declaration"]) fixture(({dir,put,invoke,config,options})=>{
      Object.assign(options,{noEmit:true,allowImportingTsExtensions:true})
      const signature="export "+(origin==="declaration"?"declare ":"")+"function risky(s: string): string"+(origin==="body"?" { return s }":";")
      put("foreign"+(origin==="body"?".ts":".d.ts"),"export type TopUnknown = unknown; export type TopAny = any;\n/** @throws {"+bound+"} */\n"+signature)
      const client='import {risky as renamed} from "./foreign.js"; export function rejected(s: string) { return renamed(s) }'
      put("main.vibe",client);config({files:["main.vibe"]});put("control.ts",client)
      const control=ts.createProgram([join(dir,"control.ts")],{noEmit:true,strict:true,types:[],module:ts.ModuleKind.NodeNext,target:ts.ScriptTarget.ES2022})
      assert.deepEqual(ts.getPreEmitDiagnostics(control).map(d=>d.code),[])
      const r=invoke("-p",".","--pretty","false")
      check(bound+"/"+origin,()=>{assert.notEqual(r.status,0,"known foreign may-throw call accepted");assert.match(r.text,/error EK04\d\d:/,r.text);assert.doesNotMatch(r.text,/error TS\d+:/)})
    })
  } else if (mode === "foreign-defaults") { fixture(({dir,put,invoke,config,options})=>{
    Object.assign(options,{noEmit:true,allowImportingTsExtensions:true})
    put("foreign.ts",'export function opaque(s: string) { return s }\n/** @throws {never} */\nexport function pure(s: string) { return s }')
    const client='import {opaque,pure} from "./foreign.js"; export function main(s: string) { return opaque(s)+pure(s) }'
    put("main.vibe",client);config({files:["main.vibe"]});const r=invoke("-p",".","--pretty","false");assert.equal(r.status,0,r.text)
    put("control.ts",client);const control=ts.createProgram([join(dir,"control.ts")],{noEmit:true,strict:true,types:[],module:ts.ModuleKind.NodeNext,target:ts.ScriptTarget.ES2022})
    assert.deepEqual(ts.getPreEmitDiagnostics(control).map(d=>d.code),[])
    })
  } else if (mode === "build-fix") { fixture(({dir,put,invoke,options})=>{
    put("tsconfig.json",{files:[],references:[{path:"./a"},{path:"./b"}]})
    for(const project of ["a","b"]){
      put(project+"/src/main.vibe",'import type { Effect } from "effect"; export type Run = Effect.Effect<number>;')
      put(project+"/tsconfig.json",{compilerOptions:{...options,composite:true,declaration:true,rootDir:"src",outDir:"build"},include:["src"],vibe:{effectGlobals:false,effectModules:false},...(project==="b"?{references:[{path:"../a"}]}:{})})
    }
    const r=invoke("--fix","-b","tsconfig.json","--pretty","false");assert.equal(r.status,0,r.text)
    for(const project of ["a","b"]) assert.doesNotMatch(readFileSync(join(dir,project,"src/main.vibe"),"utf8"),/Effect\.Effect/,"both projects fix their own files")
    const before=["a","b"].map(p=>readFileSync(join(dir,p,"src/main.vibe"),"utf8"))
    const again=invoke("--fix","-b","tsconfig.json","--pretty","false");assert.equal(again.status,0,again.text)
    assert.deepEqual(["a","b"].map(p=>readFileSync(join(dir,p,"src/main.vibe"),"utf8")),before)
    })
  } else if (mode === "only-option") fixture(({put,invoke,config,options})=>{
    Object.assign(options,{noEmit:true});put("main.vibe","export const value = 1;");config({files:["main.vibe"]})
    const r=invoke("--fix","--only","main.vibe","-p",".","--pretty","false")
    assert.notEqual(r.status,0);assert.match(r.text,/TS5023.*only/)
  })
  else throw new Error("unknown coverage oracle "+mode)
  assert.deepEqual(failures, [], mode)
}

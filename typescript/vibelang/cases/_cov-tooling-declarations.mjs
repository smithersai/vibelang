import assert from "node:assert/strict"
import { assertReferenceTypes } from "../test/cov-ch004-twin.mjs"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { nativeConsumerExtensionPolicy } from "./_native-consumer-extension-policy.mjs"

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
    nativeConsumerExtensionPolicy("admission")
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
      // Public output follows the native twin; source spellings belong to sidecars.
      const expected = readFileSync(join(dir,"stock/main.d.ts"),"utf8")
      check("public/" + [suffix,rewrite,allow].join("/"), () => {
        assert.equal(readFileSync(join(dir,"out/main.d.ts"),"utf8"), expected, fork.text)
      })
      check("sidecar/" + [suffix,rewrite,allow].join("/"), () => {
        const adjacent = join(dir,"main.d"+suffix+".ts")
        assert.ok(existsSync(adjacent), "missing compatibility declaration")
        assert.ok(readFileSync(adjacent,"utf8").includes("./producer"+suffix), "adjacent compatibility output must keep the source suffix")
      })
    })
  } else if (mode === "retired-option") {
    for (const value of [".js", ".ts", "extensionless", null, false, 42, [], {}, [false, "["]]) for (const nested of [false,true]) fixture(({dir,put,invoke,config,options}) => {
      Object.assign(options,{ noEmitOnError: true })
      put("main.vibe","export const value = 1;")
      put("main.ts","export const value = 1;")
      const retired = { declarationImportStyle: value, trustedPackages: value }
      config({ files: ["main.vibe"], ...(nested ? { compilerOptions: { ...options, vibelang: retired } } : { vibelang: retired }) })
      // Stock TypeScript owns the native twin: custom root keys are ignored,
      // while an unknown compilerOptions.vibelang is TS5023.
      const nativeConfig = ts.readConfigFile(join(dir,"tsconfig.json"), ts.sys.readFile)
      nativeConfig.config.files = ["main.ts"]
      const native = ts.parseJsonConfigFileContent(nativeConfig.config, ts.sys, dir)
      assert.deepEqual(native.errors.map(d=>d.code), nested ? [5023] : [])
      const r=invoke("-p",".","--pretty","false")
      check(JSON.stringify({nested,value}),()=>{
        assert.equal(r.status,0,r.text)
        assert.equal((r.text.match(/warning EK301[01]:/g)||[]).length,2,r.text)
        for (const key of Object.keys(retired)) assert.match(r.text,new RegExp("warning EK"+(key === "trustedPackages" ? "3010" : "3011")+":.*"+key+".*ignored"),r.text)
        assert.ok(existsSync(join(dir,"out/main.js")),"warnings must not block noEmitOnError")
        const shown=invoke("-p",".","--showConfig")
        assert.equal(shown.status,0,shown.text)
        const effective=JSON.parse(shown.stdout)
        assert.doesNotMatch(JSON.stringify(effective), /declarationImportStyle|trustedPackages/)
      })
    })
    fixture(({put,invoke,config}) => {
      put("main.vibe","export const value = 1;")
      config({files:["main.vibe"],vibe:{effectGlobals:false,effectModules:false,trustedPackages:42}})
      const r=invoke("-p",".","--pretty","false")
      assert.equal(r.status,0,r.text);assert.match(r.text,/warning EK3010:.*trustedPackages.*ignored/)
      const shown=invoke("-p",".","--showConfig")
      assert.equal(shown.status,0,shown.text);assert.doesNotMatch(JSON.stringify(JSON.parse(shown.stdout)),/trustedPackages/)
    })
    fixture(({dir,put,invoke,config,options}) => {
      put("node_modules/retired-config-fixture/package.json", { type:"module", exports:{ types:"./index.d.ts", default:"./index.js" } })
      put("node_modules/retired-config-fixture/index.d.ts", "export declare function risky(fail: boolean): number; export declare const marker: object;")
      put("node_modules/retired-config-fixture/index.js", "export const marker = {}; export function risky(fail) { if (fail) throw marker; return 42 }")
      put("main.vibe", 'import { Effect } from "effect"; import { risky } from "retired-config-fixture"; export effect function main(fail: boolean) { return risky(fail) }')
      Object.assign(options,{ noEmitOnError:true, declaration:true })
      config({ files:["main.vibe"], vibelang:{trustedPackages:["retired-config-fixture"]} })
      const rejected=invoke("-p",".","--pretty","false")
      assert.notEqual(rejected.status,0,rejected.text)
      assert.match(rejected.text,/EK0403/)
      assert.doesNotMatch(rejected.text,/list its package.*trustedPackages/,"foreign-call advice must not recommend a retired setting")
      const fixed=invoke("-p",".","--fix","--pretty","false")
      assert.equal(fixed.status,0,fixed.text)
      put("api.ts", 'import { main } from "./out/main.js"; import { Effect } from "effect"; type Native = (fail: boolean) => Effect.Effect<number>; const native: Native = main; const vibe: typeof main = (fail: boolean) => Effect.succeed(42);')
      const contract=ts.createProgram([join(dir,"api.ts")], { noEmit:true, strict:true, types:[], skipLibCheck:true, target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.NodeNext, moduleResolution:ts.ModuleResolutionKind.NodeNext })
      assert.deepEqual(ts.getPreEmitDiagnostics(contract).map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[],"repair must preserve the native twin's Effect type in both directions")
      const source=readFileSync(join(dir,"main.vibe"),"utf8")
      const again=invoke("-p",".","--fix","--pretty","false")
      assert.equal(again.status,0,again.text)
      assert.equal(readFileSync(join(dir,"main.vibe"),"utf8"),source,"repair must converge")
      const probe=spawnSync(process.execPath,["--input-type=module","-e",`
        import assert from "node:assert/strict";
        import { Effect, Exit, Cause } from "effect";
        import { marker } from "retired-config-fixture";
        import { main } from "./out/main.js";
        const success=Effect.runSyncExit(main(false));
        assert.ok(Exit.isSuccess(success)); assert.equal(success.value,42);
        const failure=Effect.runSyncExit(main(true));
        assert.ok(Exit.isFailure(failure)); assert.equal(Cause.squash(failure.cause),marker);
      `],{cwd:dir,encoding:"utf8",timeout:30000})
      assert.ifError(probe.error);assert.equal(probe.status,0,probe.stdout+probe.stderr)
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
    put("main.vibe","export async function each(f: () => void) { f() }\n")
    config({files:["main.vibe"]});const r=invoke("-p",".","--pretty","false");assert.equal(r.status,0,r.text)
    const text=readFileSync(join(dir,"out/main.d.ts"),"utf8")
    assert.match(text,/@throws \{never\}/);assert.doesNotMatch(text,/@throws \{unknown\}|@rethrows/)
    put("main.ts", "export async function each(f: () => void) { f() }\n")
    const twin = ts.createProgram([join(dir, "main.ts")], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, strict: true, types: [], declaration: true, emitDeclarationOnly: true, outDir: join(dir, "stock") })
    assert.deepEqual(ts.getPreEmitDiagnostics(twin).map(d => d.code), [])
    assert.equal(twin.emit().emitSkipped, false)
    assertReferenceTypes(ts, dir, undefined, { before: "stock/main.d.ts", after: "out/main.d.ts" })
    const native=ts.createProgram([join(dir,"out/main.d.ts")],{noEmit:true,types:[],skipLibCheck:true})
    assert.deepEqual(ts.getPreEmitDiagnostics(native).map(d=>d.code),[])
    })
  } else if (mode === "matcher-declarations") {
    for(const suffix of [".vibe",".vibex"]) fixture(({dir,put,invoke,config,options})=>{
      Object.assign(options,{declaration:true,emitDeclarationOnly:true});put("main"+suffix,'export error Missing { id: string }\nexport schema error Invalid { message: string }\n')
      config({files:["main"+suffix]});const r=invoke("-p",".","--pretty","false");assert.equal(r.status,0,r.text)
      for(const entry of ["out/main.d.ts","main.d"+suffix+".ts"]) check(suffix+"/"+entry,()=>{
        const text=readFileSync(join(dir,entry),"utf8")
        assert.doesNotMatch(text, /reference types="vibelang-runtime"|Symbol\.customMatcher/, "no generated runtime protocol in declarations")
        assert.equal((text.match(/static \[/g)||[]).length,0,"neither class kind adds a matcher")
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
    // VIP-34, amended (fab37b46453e): --fix --only limits repairs to the listed modules; --only requires --fix.
    const r=invoke("--fix","--only","main.vibe","-p",".","--pretty","false")
    assert.equal(r.status,0,r.text)
    const bare=invoke("--only","main.vibe","-p",".","--pretty","false")
    assert.notEqual(bare.status,0);assert.match(bare.text,/TS5023.*only/)
  })
  else throw new Error("unknown coverage oracle "+mode)
  assert.deepEqual(failures, [], mode)
}

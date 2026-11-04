import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { fixToFixedPoint } from "../../../.smithers/flows/migrate/lib/codemod.mjs"
import { loadTypeScript } from "../../../.smithers/flows/migrate/lib/declarations.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const dependencyRoot = process.env.VIBELANG_TEST_DEPENDENCIES ?? join(root, "packages/runtime")
const require = createRequire(join(dependencyRoot, "package.json"))
const Effect = require("effect/Effect")
const fc = createRequire(new URL("../package.json", import.meta.url))(process.env.VIBELANG_FAST_CHECK ?? "fast-check")
const ts = loadTypeScript([dependencyRoot, root])
const binary = process.env.VIBELANG_BINARY ?? join(root, "packages/compiler/native/vibelang")
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, declaration: true, strict: true, skipLibCheck: true, types: [], outDir: "out", rewriteRelativeImportExtensions: true }
const compilerOptions = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", declaration: true, strict: true, skipLibCheck: true, types: [], outDir: "out", rewriteRelativeImportExtensions: true }
const run = (cwd, args) => {
  const result = spawnSync(binary, args, { cwd, encoding: "utf8", timeout: 90000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}
function observed(module, name, args) {
  module.trace.length = 0
  const program = module[name](...args)
  const constructed = [...module.trace]
  const exit = Effect.runSyncExit(program)
  const value = exit._tag === "Success" ? ["Success", exit.value] :
    ["Failure", ...exit.cause.reasons.map(reason => [reason._tag, reason.error?._tag, reason.error?.state])]
  return { constructed, value, trace: [...module.trace] }
}


test("shared Effect.fn conversion defers parameter bindings until each execution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "migrate-parameter-phase-"))
  try {
    mkdirSync(join(directory, "node_modules"))
    for (const name of ["effect", "vibelang-runtime"]) {
      const installed = join(dependencyRoot,"node_modules",name)
      symlinkSync(name === "vibelang-runtime" && !existsSync(installed) ? dependencyRoot : installed,join(directory,"node_modules",name),"dir")
    }
    writeFileSync(join(directory,"package.json"),'{"type":"module"}\n')
    const source = readFileSync(new URL("./corpus/alchemy-effect-fn-parameter-phase.ts",import.meta.url),"utf8")
    writeFileSync(join(directory,"oracle.ts"),source)
    const program = ts.createProgram([join(directory,"oracle.ts")],{...options,outDir:join(directory,"oracle")})
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[])
    assert.equal(program.emit().emitSkipped,false)
    const oracle = await import(pathToFileURL(join(directory,"oracle/oracle.js")))
    writeFileSync(join(directory,"input.vibe"),source)
    writeFileSync(join(directory,"tsconfig.json"),JSON.stringify({compilerOptions,files:["input.vibe"]}))
    const fixed = await fixToFixedPoint({compiler:binary,root:directory,cwd:directory,tsconfig:"tsconfig.json",only:["input.vibe"],maxRounds:6,timeoutMs:90000})
    assert.equal(fixed.settled,true)
    assert.deepEqual(fixed.diagnostics.filter(d=>d.category==="error"),[])
    const converted=readFileSync(join(directory,"input.vibe"),"utf8")
    assert.doesNotMatch(converted,/diff:\s*Effect\.fn\b/)
    assert.match(converted,/initialized\s*=\s*Effect\.fn\b/)
    run(directory,["-p",".","--pretty","false","--singleThreaded"])
    assert.equal(readFileSync(join(directory,"out/input.d.ts"),"utf8"),readFileSync(join(directory,"oracle/oracle.d.ts"),"utf8"),"public declaration bytes changed")
    const native=await import(pathToFileURL(join(directory,"out/input.js")))
    const observe=(module,initial,later,output,property="provider")=>{
      const reads=[]
      let current=initial
      const argument={get news(){reads.push("news:"+current);return current},get output(){reads.push("output:"+output);return output}}
      const operation=module[property].diff(argument)
      const construction=[...reads]
      current=later
      const first=Effect.runSync(operation)
      current=initial
      const second=Effect.runSync(operation)
      return {construction,reads,first,second,length:module[property].diff.length}
    }
    fc.assert(fc.property(fc.string(),fc.string(),fc.boolean(),(initial,later,output)=>{
      for(const property of ["provider","contextual","plain","withDefaults"]) assert.deepEqual(observe(native,initial,later,output,property),observe(oracle,initial,later,output,property))
      assert.deepEqual(observe(native,initial,later,undefined,"withDefaults"),observe(oracle,initial,later,undefined,"withDefaults"))
      for(const module of [native,oracle]){
        const argument={news:initial}
        const initialized=module.initialized(argument)
        argument.news=later
        assert.equal(Effect.runSync(initialized),later+later)
        assert.equal(module.initialized.length,1)
      }
    }),{seed:561208,numRuns:240})
    for(const property of ["provider","contextual"]) for(const module of [native,oracle]) {
      const failure={synthetic:"getter defect"}
      const input={get news(){throw failure},output:true}
      let operation
      assert.doesNotThrow(()=>{operation=module[property].diff(input)})
      const exit=Effect.runSyncExit(operation)
      assert.equal(exit._tag,"Failure")
      assert.equal(exit.cause.reasons[0]._tag,"Die")
      assert.equal(exit.cause.reasons[0].defect,failure)
    }
  } finally {rmSync(directory,{recursive:true,force:true})}
})


test("destructuring with rest refuses conversion that would add observable iteration",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"migrate-rest-phase-refusal-"))
  try {
    mkdirSync(join(directory,"node_modules"))
    for(const name of ["effect","vibelang-runtime"]) {
      const installed=join(dependencyRoot,"node_modules",name)
      symlinkSync(name==="vibelang-runtime" && !existsSync(installed)?dependencyRoot:installed,join(directory,"node_modules",name),"dir")
    }
    writeFileSync(join(directory,"package.json"),'{"type":"module"}\n')
    const source=readFileSync(new URL("./corpus/alchemy-effect-fn-rest-phase.ts",import.meta.url),"utf8")
    writeFileSync(join(directory,"oracle.ts"),source)
    const program=ts.createProgram([join(directory,"oracle.ts")],{...options,outDir:join(directory,"oracle")})
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[])
    writeFileSync(join(directory,"input.vibe"),source)
    writeFileSync(join(directory,"tsconfig.json"),JSON.stringify({compilerOptions,files:["input.vibe"]}))
    const fixed=await fixToFixedPoint({compiler:binary,root:directory,cwd:directory,tsconfig:"tsconfig.json",only:["input.vibe"],maxRounds:6,timeoutMs:90000})
    assert.equal(fixed.settled,true)
    const errors=fixed.diagnostics.filter(d=>d.category==="error")
    assert.deepEqual(errors,[])
    const converted=readFileSync(join(directory,"input.vibe"),"utf8")
    assert.match(converted,/withRest\s*=\s*Effect\.fn\b/)
    assert.doesNotMatch(converted,/\.\.\.argument[0-9]+/)
    assert.equal(program.emit().emitSkipped,false)
    const oracle=await import(pathToFileURL(join(directory,"oracle/oracle.js")))
    run(directory,["-p",".","--pretty","false","--singleThreaded"])
    const native=await import(pathToFileURL(join(directory,"out/input.js")))
    for(const module of [oracle,native]) {
      const input={news:"before"}
      const operation=module.withRest(input,"prefix")
      input.news="after"
      assert.equal(Effect.runSync(operation),"prefix:after")
      assert.equal(Effect.runSync(operation),"prefix:after")
      assert.equal(module.withRest.length,1)
    }
  } finally {rmSync(directory,{recursive:true,force:true})}
})

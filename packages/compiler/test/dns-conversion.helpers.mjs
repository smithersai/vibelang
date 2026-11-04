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
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, types: [], outDir: "out", rewriteRelativeImportExtensions: true }
const compilerOptions = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], outDir: "out", rewriteRelativeImportExtensions: true }
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


export function dnsConversionTest(shape) { test(`shared DNS conversion preserves ${shape}`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),"migrate-dns-rules-"))
  try {
    mkdirSync(join(directory,"node_modules"))
    for(const name of ["effect","vibelang-runtime"]) {
      const installed=join(dependencyRoot,"node_modules",name)
      symlinkSync(name==="vibelang-runtime" && !existsSync(installed) ? dependencyRoot : installed,join(directory,"node_modules",name),"dir")
    }
    writeFileSync(join(directory,"package.json"),'{"type":"module"}\n')
    const source=readFileSync(new URL(`./corpus/alchemy-dns-${shape}.ts`,import.meta.url),"utf8")
    writeFileSync(join(directory,"oracle.ts"),source)
    const program=ts.createProgram([join(directory,"oracle.ts")],{...options,outDir:join(directory,"oracle")})
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[])
    assert.equal(program.emit().emitSkipped,false)
    const oracle=await import(pathToFileURL(join(directory,"oracle/oracle.js")))
    writeFileSync(join(directory,"input.vibe"),source)
    writeFileSync(join(directory,"tsconfig.json"),JSON.stringify({compilerOptions,files:["input.vibe"]}))
    const fixed=await fixToFixedPoint({compiler:binary,root:directory,cwd:directory,tsconfig:"tsconfig.json",only:["input.vibe"],maxRounds:6,timeoutMs:90000})
    assert.equal(fixed.settled,true)
    assert.deepEqual(fixed.diagnostics.filter(d=>d.category==="error"),[])
    const converted=readFileSync(join(directory,"input.vibe"),"utf8")
    if(shape==="pure-request") {
      assert.doesNotMatch(converted,/\.pipe\(/)
      assert.match(converted,/setUrlParams\(%,/)
      assert.match(converted,/setHeader\(%,/)
    } else if(shape==="stored-programs") {
      assert.ok(!fixed.diagnostics.some(d=>d.code==="EK4802"),"stored program intent must remain explicit")
      assert.match(converted,/\.map</)
    } else {
      assert.doesNotMatch(converted,/Effect\.provide\(/)
      assert.match(converted,/const automatic/)
    }
    run(directory,["-p",".","--pretty","false","--singleThreaded"])
    const native=await import(pathToFileURL(join(directory,"out/input.js")))
    if(shape==="pure-request") fc.assert(fc.property(fc.string(),fc.string(),(name,value)=>{
      assert.deepEqual(native.make(name,value),oracle.make(name,value))
    }),{seed:561209,numRuns:240})
    else if(shape==="stored-programs") fc.assert(fc.property(fc.array(fc.string(),{maxLength:8}),fc.string(),(servers,value)=>{
      assert.deepEqual(observed(native,"lookup",[servers,value]),observed(oracle,"lookup",[servers,value]))
    }),{seed:561210,numRuns:240})
    else fc.assert(fc.property(fc.integer(),value=>{
      assert.deepEqual(observed(native,"provided",[value]),observed(oracle,"provided",[value]))
    }),{seed:561211,numRuns:240})
    await fixToFixedPoint({compiler:binary,root:directory,cwd:directory,tsconfig:"tsconfig.json",only:["input.vibe"],maxRounds:6,timeoutMs:90000})
    assert.equal(readFileSync(join(directory,"input.vibe"),"utf8"),converted)
  } finally {rmSync(directory,{recursive:true,force:true})}
}) }
